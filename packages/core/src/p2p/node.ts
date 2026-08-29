import { EventEmitter } from 'node:events';
import Hyperswarm from 'hyperswarm';
import { SealedPayload, open, seal, topicFromServerKey } from '../crypto/serverKey';
import { ConcordStore } from '../store';
import { Operation } from '../ops/types';
import {
  FrameDecoder,
  VoiceSignal,
  Message,
  computeHeads,
  encodeFrame,
  operationsMissingFor,
} from './protocol';

interface PeerConnection {
  socket: NodeJS.WritableStream & { destroy(): void };
  decoder: FrameDecoder;
  remoteKey: string;
  /** Chave publica Concord, conhecida so apos o hello. */
  identityKey: string | null;
}

/**
 * Liga o log local a rede: descobre peers pela DHT, troca operacoes cifradas e
 * avisa a UI quando algo novo chega.
 *
 * O topico e derivado da chave do servidor, nao do serverId. Consequencia: sem
 * a chave nao se encontra o swarm, e mesmo dentro dele as operacoes chegam
 * cifradas. Antes bastava conhecer o UUID do servidor para ler tudo.
 */
export class P2PNode extends EventEmitter {
  private swarm: InstanceType<typeof Hyperswarm> | null = null;
  private readonly peers = new Map<string, PeerConnection>();
  private readonly joined = new Set<string>();

  constructor(private readonly store: ConcordStore) {
    super();
  }

  async start(): Promise<void> {
    if (this.swarm) return;
    this.swarm = new Hyperswarm();

    this.swarm.on('connection', (socket: any, info: any) => {
      const remoteKey: string = info.publicKey.toString('hex');
      const peer: PeerConnection = {
        socket,
        decoder: new FrameDecoder(),
        remoteKey,
        identityKey: null,
      };
      this.peers.set(remoteKey, peer);
      this.emit('peer:connect', remoteKey);

      socket.on('data', (chunk: Buffer) => {
        let messages: Message[];
        try {
          messages = peer.decoder.push(chunk);
        } catch {
          socket.destroy();
          return;
        }
        for (const message of messages) {
          try {
            this.handle(peer, message);
          } catch {
            // Um peer nao pode derrubar o no com uma mensagem malformada.
          }
        }
      });

      const drop = () => {
        this.peers.delete(remoteKey);
        this.emit('peer:disconnect', remoteKey);
      };
      socket.on('close', drop);
      socket.on('error', drop);

      this.send(peer, {
        t: 'hello',
        servers: this.readableServers(),
        me: this.store.publicKeyHex,
      });
    });

    for (const { serverId } of this.store.knownServerKeys()) {
      await this.joinServer(serverId);
    }
  }

  /** Servidores cuja chave temos - os unicos que conseguimos ler ou anunciar. */
  private readableServers(): string[] {
    return this.store.knownServerKeys().map((s) => s.serverId);
  }

  async joinServer(serverId: string): Promise<void> {
    if (!this.swarm || this.joined.has(serverId)) return;

    const key = this.store.serverKey(serverId);
    if (!key) return; // Sem chave nao ha topico a entrar.

    this.joined.add(serverId);
    const discovery = this.swarm.join(topicFromServerKey(key), { server: true, client: true });
    await discovery.flushed();
  }

  private send(peer: PeerConnection, message: Message): void {
    try {
      peer.socket.write(encodeFrame(message));
    } catch {
      // Peer caiu no meio da escrita; o handler de 'close' faz a limpeza.
    }
  }

  /** Cifra as operacoes com a chave do servidor antes de coloca-las na rede. */
  private sendOps(peer: PeerConnection, serverId: string, ops: Operation[]): void {
    const key = this.store.serverKey(serverId);
    if (!key || ops.length === 0) return;
    this.send(peer, { t: 'ops', serverId, sealed: seal(key, JSON.stringify(ops)) });
  }

  private handle(peer: PeerConnection, message: Message): void {
    switch (message.t) {
      case 'hello': {
        peer.identityKey = message.me;
        const legiveis = new Set(this.readableServers());
        for (const serverId of message.servers) {
          if (!legiveis.has(serverId)) continue;
          this.send(peer, {
            t: 'have',
            serverId,
            heads: computeHeads(this.store.operationsFor(serverId)),
          });
        }
        break;
      }

      case 'have': {
        if (!this.store.serverKey(message.serverId)) break;
        const locais = this.store.operationsFor(message.serverId);
        this.sendOps(peer, message.serverId, operationsMissingFor(locais, message.heads));
        this.send(peer, {
          t: 'want',
          serverId: message.serverId,
          heads: computeHeads(locais),
        });
        break;
      }

      case 'want': {
        if (!this.store.serverKey(message.serverId)) break;
        this.sendOps(
          peer,
          message.serverId,
          operationsMissingFor(this.store.operationsFor(message.serverId), message.heads),
        );
        break;
      }

      case 'ops': {
        const key = this.store.serverKey(message.serverId);
        if (!key) break;

        // Decifrar so funciona com a chave certa: um peer que entrou no topico
        // por engano nao consegue injetar nada.
        const plaintext = open(key, message.sealed as SealedPayload);
        if (plaintext === null) break;

        let ops: Operation[];
        try {
          ops = JSON.parse(plaintext) as Operation[];
        } catch {
          break;
        }
        if (!Array.isArray(ops)) break;

        // applyRemoteOperations valida assinatura, formato e permissao.
        const { accepted } = this.store.applyRemoteOperations(ops);
        if (accepted > 0) {
          this.emit('ops:received', { serverId: message.serverId, accepted });
        }
        break;
      }

      case 'voice': {
        const key = this.store.serverKey(message.serverId);
        if (!key) break;

        const plaintext = open(key, message.sealed as SealedPayload);
        if (plaintext === null) break;

        let signal: VoiceSignal;
        try {
          signal = JSON.parse(plaintext) as VoiceSignal;
        } catch {
          break;
        }
        if (!signal || typeof signal.kind !== 'string' || typeof signal.channelId !== 'string') {
          break;
        }

        // O `from` declarado no payload e ignorado em favor da identidade que o
        // peer anunciou no hello: senao qualquer um se passaria por outro na
        // sinalizacao.
        if (!peer.identityKey) break;
        signal.from = peer.identityKey;

        // Descarta o que nao e para nos.
        if (signal.to && signal.to !== this.store.publicKeyHex) break;

        this.emit('voice:signal', { serverId: message.serverId, signal });
        break;
      }
    }
  }

  /**
   * Envia um sinal de voz. Com `to` definido vai so para aquele peer; sem ele,
   * difunde para todos os peers do servidor.
   */
  sendVoiceSignal(serverId: string, signal: VoiceSignal): void {
    const key = this.store.serverKey(serverId);
    if (!key) return;

    const sealed = seal(key, JSON.stringify({ ...signal, from: this.store.publicKeyHex }));
    for (const peer of this.peers.values()) {
      if (signal.to && peer.identityKey !== signal.to) continue;
      this.send(peer, { t: 'voice', serverId, sealed });
    }
  }

  /** Empurra operacoes locais recem-criadas para todos os peers conectados. */
  broadcast(serverId: string, ops: Operation[]): void {
    if (ops.length === 0) return;
    for (const peer of this.peers.values()) this.sendOps(peer, serverId, ops);
  }

  peerCount(): number {
    return this.peers.size;
  }

  async destroy(): Promise<void> {
    for (const peer of this.peers.values()) peer.socket.destroy();
    this.peers.clear();
    await this.swarm?.destroy();
    this.swarm = null;
  }
}
