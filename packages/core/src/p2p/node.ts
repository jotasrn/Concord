import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import Hyperswarm from 'hyperswarm';
import { ConcordStore } from '../store';
import { Operation } from '../ops/types';
import {
  FrameDecoder,
  Message,
  computeHeads,
  encodeFrame,
  operationsMissingFor,
} from './protocol';

/**
 * O topico da DHT e derivado do serverId por hash, entao entrar no swarm nao
 * revela o id do servidor.
 *
 * ATENCAO: quem conhece o serverId consegue entrar no topico e ler o log. O
 * serverId (UUID v4, 122 bits) funciona hoje como capacidade secreta. Cifrar
 * as operacoes com uma chave de servidor esta em docs/SYNC.md como proximo
 * passo de seguranca.
 */
export function serverTopic(serverId: string): Buffer {
  return createHash('sha256').update(`concord:server:${serverId}`).digest();
}

interface PeerConnection {
  socket: NodeJS.WritableStream & { destroy(): void };
  decoder: FrameDecoder;
  remoteKey: string;
}

export interface P2PNodeEvents {
  'peer:connect': [string];
  'peer:disconnect': [string];
  'ops:received': [{ serverId: string; accepted: number }];
}

/**
 * Liga o log local a rede: descobre peers pela DHT, troca operacoes e avisa a
 * UI quando algo novo chega.
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
      const peer: PeerConnection = { socket, decoder: new FrameDecoder(), remoteKey };
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
        for (const message of messages) this.handle(peer, message);
      });

      const drop = () => {
        this.peers.delete(remoteKey);
        this.emit('peer:disconnect', remoteKey);
      };
      socket.on('close', drop);
      socket.on('error', drop);

      // Abre o handshake dizendo em quais servidores estamos.
      this.send(peer, { t: 'hello', servers: this.store.listServers().map((s) => s.id) });
    });

    // Entra nos topicos de todos os servidores ja conhecidos.
    for (const server of this.store.listServers()) {
      await this.joinServer(server.id);
    }
  }

  async joinServer(serverId: string): Promise<void> {
    if (!this.swarm || this.joined.has(serverId)) return;
    this.joined.add(serverId);
    const discovery = this.swarm.join(serverTopic(serverId), { server: true, client: true });
    await discovery.flushed();
  }

  private send(peer: PeerConnection, message: Message): void {
    try {
      peer.socket.write(encodeFrame(message));
    } catch {
      // Peer caiu no meio da escrita; o handler de 'close' faz a limpeza.
    }
  }

  private handle(peer: PeerConnection, message: Message): void {
    switch (message.t) {
      case 'hello': {
        // Para cada servidor em comum, conta ao peer o que ja temos.
        const locais = new Set(this.store.listServers().map((s) => s.id));
        for (const serverId of message.servers) {
          if (!locais.has(serverId)) continue;
          this.send(peer, {
            t: 'have',
            serverId,
            heads: computeHeads(this.store.operationsFor(serverId)),
          });
        }
        break;
      }

      case 'have': {
        // O peer disse onde parou: mandamos o que falta e pedimos o nosso.
        const locais = this.store.operationsFor(message.serverId);
        const faltando = operationsMissingFor(locais, message.heads);
        if (faltando.length > 0) {
          this.send(peer, { t: 'ops', serverId: message.serverId, ops: faltando });
        }
        this.send(peer, {
          t: 'want',
          serverId: message.serverId,
          heads: computeHeads(locais),
        });
        break;
      }

      case 'want': {
        const faltando = operationsMissingFor(
          this.store.operationsFor(message.serverId),
          message.heads,
        );
        if (faltando.length > 0) {
          this.send(peer, { t: 'ops', serverId: message.serverId, ops: faltando });
        }
        break;
      }

      case 'ops': {
        // applyRemoteOperations valida assinatura e permissao de cada uma.
        const { accepted } = this.store.applyRemoteOperations(message.ops);
        if (accepted > 0) {
          this.emit('ops:received', { serverId: message.serverId, accepted });
        }
        break;
      }
    }
  }

  /** Empurra operacoes locais recem-criadas para todos os peers conectados. */
  broadcast(serverId: string, ops: Operation[]): void {
    if (ops.length === 0) return;
    for (const peer of this.peers.values()) {
      this.send(peer, { t: 'ops', serverId, ops });
    }
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
