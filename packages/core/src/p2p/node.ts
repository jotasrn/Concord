import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import Hyperswarm from 'hyperswarm';
import { SealedPayload, inboxTopic, open, seal, topicFromServerKey } from '../crypto/serverKey';
import { fromHex, sign, verify } from '../identity/keypair';
import { ConcordStore } from '../store';
import { Operation } from '../ops/types';
import {
  FrameDecoder,
  PeerPresence,
  authMessage,
  PresencePayload,
  PresenceStatus,
  VoiceSignal,
  isPresenceStatus,
  Message,
  computeHeads,
  encodeFrame,
  operationsMissingFor,
} from './protocol';

/** Quanto esperar a conexao antes de dizer que a mensagem ficou na fila. */
const DELIVERY_WAIT_MS = 12_000;

interface PeerConnection {
  socket: NodeJS.WritableStream & { destroy(): void };
  decoder: FrameDecoder;
  remoteKey: string;
  /** Chave publica Concord, definida SO apos a prova de identidade. */
  identityKey: string | null;
  /** Nonce que enviamos; a resposta precisa ser assinada sobre ele. */
  challenge: string | null;
  /**
   * Ja respondemos a um 'auth:challenge' nesta conexao?
   *
   * So deveria existir UM challenge por conexao - o que o proprio handler de
   * 'connection' manda na hora. Sem travar isso, um terceiro conectado a nos
   * (M) podia nos mandar um 'auth:challenge' extra, forjado com o nonce que
   * uma VITIMA (V) gerou para M em outra conexao - nos assinariamos de boa, e
   * M devolveria essa assinatura a V se passando por nos. Assinar o nonce
   * errado uma segunda vez e exatamente o que isto impede.
   */
  answeredChallenge: boolean;
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

  /**
   * Status declarado por cada peer conectado. Some quando a conexao cai, que e
   * exatamente o significado de ficar offline: nao ha registro a manter.
   */
  private readonly presence = new Map<string, { status: PresenceStatus; voice: string | null; at: number }>();
  private myStatus: PresenceStatus = 'ONLINE';
  private myVoiceChannel: string | null = null;

  /** Mensagens esperando o destinatario aparecer e provar quem e. */
  private readonly pendingInbox = new Map<string, Message[]>();
  private readonly joinedInboxes = new Set<string>();
  /** Avisa quem esta esperando para saber se a entrega saiu. */
  private readonly pendingResolvers = new Map<string, () => void>();

  constructor(private readonly store: ConcordStore) {
    super();
  }

  async start(): Promise<void> {
    if (this.swarm) return;
    this.swarm = new Hyperswarm();

    this.swarm.on('connection', (socket, info) => {
      const remoteKey: string = info.publicKey.toString('hex');
      const peer: PeerConnection = {
        socket,
        decoder: new FrameDecoder(),
        remoteKey,
        identityKey: null,
        challenge: null,
        answeredChallenge: false,
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
        const identity = peer.identityKey;
        this.peers.delete(remoteKey);
        // So marca offline se nao houver outra conexao com a mesma identidade.
        if (identity && ![...this.peers.values()].some((p) => p.identityKey === identity)) {
          this.presence.delete(identity);
          this.emit('presence:update', this.presenceSnapshot());
        }
        this.emit('peer:disconnect', remoteKey);
      };
      socket.on('close', drop);
      socket.on('error', drop);

      // Nada de util e enviado antes da prova de identidade: o resto do
      // protocolo depende de saber com quem estamos falando.
      peer.challenge = randomBytes(24).toString('hex');
      this.send(peer, { t: 'auth:challenge', nonce: peer.challenge });
    });

    // O topico proprio e como pedidos de amizade e convites chegam ate nos.
    const meuTopico = this.swarm.join(inboxTopic(this.store.publicKeyHex), {
      server: true,
      client: true,
    });
    await meuTopico.flushed();

    for (const { serverId } of this.store.knownServerKeys()) {
      await this.joinServer(serverId);
    }
  }

  /**
   * Abre o topico pessoal de outro usuario para entregar um pedido.
   *
   * A mensagem fica na fila ate aparecer um peer que prove ser o destinatario.
   * Sem essa espera, o convite poderia ser entregue a qualquer um que estivesse
   * ouvindo o topico - e o convite carrega a chave do servidor.
   */
  async sendToUser(
    targetPublicKey: string,
    message: Message,
  ): Promise<'entregue' | 'na-fila'> {
    if (!this.swarm) throw new Error('Rede nao iniciada');

    const jaVerificado = [...this.peers.values()].find(
      (p) => p.identityKey === targetPublicKey,
    );
    if (jaVerificado) {
      this.send(jaVerificado, message);
      return 'entregue';
    }

    const fila = this.pendingInbox.get(targetPublicKey) ?? [];
    fila.push(message);
    this.pendingInbox.set(targetPublicKey, fila);

    /*
     * Espera um pouco antes de responder.
     *
     * Achar o peer na DHT e conectar leva alguns segundos. Sem essa espera a
     * resposta seria sempre "na fila", mesmo quando a entrega acontece logo em
     * seguida - e o usuario levaria um aviso preocupante sobre algo que ja
     * funcionou.
     *
     * A promessa e registrada ANTES de entrar no topico: o peer pode conectar
     * e receber a mensagem durante o `flushed()`, e nesse caso nao haveria
     * ninguem inscrito para saber que a entrega saiu.
     */
    const entrega = new Promise<'entregue' | 'na-fila'>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingResolvers.delete(targetPublicKey);
        resolve('na-fila');
      }, DELIVERY_WAIT_MS);

      this.pendingResolvers.set(targetPublicKey, () => {
        clearTimeout(timer);
        this.pendingResolvers.delete(targetPublicKey);
        resolve('entregue');
      });
    });

    if (!this.joinedInboxes.has(targetPublicKey)) {
      this.joinedInboxes.add(targetPublicKey);
      const discovery = this.swarm.join(inboxTopic(targetPublicKey), {
        server: false,
        client: true,
      });
      await discovery.flushed();
    }

    return entrega;
  }

  /** Ja existe conexao verificada com esta pessoa? */
  isPeerOnline(publicKey: string): boolean {
    return [...this.peers.values()].some((p) => p.identityKey === publicKey);
  }

  /** Quantas mensagens ainda esperam entrega, por destinatario. */
  pendingCount(publicKey: string): number {
    return this.pendingInbox.get(publicKey)?.length ?? 0;
  }

  /** Entrega o que estava na fila assim que a identidade e confirmada. */
  private flushInbox(peer: PeerConnection): void {
    if (!peer.identityKey) return;
    const fila = this.pendingInbox.get(peer.identityKey);
    if (!fila || fila.length === 0) return;

    for (const message of fila) this.send(peer, message);
    this.pendingInbox.delete(peer.identityKey);

    this.pendingResolvers.get(peer.identityKey)?.();
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

    /*
     * Reanuncia para quem ja esta conectado.
     *
     * O `hello` traz a lista de servidores legiveis e acontece uma vez, logo
     * apos a verificacao de identidade. Ao aceitar um convite passamos a
     * conhecer um servidor novo, mas o peer que nos convidou ja trocou o hello
     * dele - sem este reenvio, ele so descobriria que agora compartilhamos
     * aquele servidor na proxima reconexao, e o historico nunca chegaria.
     */
    for (const peer of this.peers.values()) {
      if (!peer.identityKey) continue;
      this.send(peer, { t: 'hello', servers: this.readableServers() });
      this.announcePresenceTo(peer);
    }
  }

  private send(peer: PeerConnection, message: Message): void {
    try {
      peer.socket.write(encodeFrame(message));
    } catch {
      // Peer caiu no meio da escrita; o handler de 'close' faz a limpeza.
    }
  }

  /** Cifra as operacoes com a chave do servidor antes de coloca-las na rede. */
  /**
   * Tamanho de cada lote de operacoes por frame.
   *
   * Sem isto, um peer que ficou offline muito tempo (ou um historico grande
   * de servidor) virava UM frame so, do tamanho do catch-up inteiro - e o
   * limite de frame (`MAX_FRAME_BYTES` em protocol.ts) precisava ser grande o
   * bastante pra caber isso, o que tambem dava a QUALQUER UM margem para
   * mandar um frame enorme de uma vez. Indo em lotes, o catch-up de qualquer
   * tamanho sai em varios frames menores - cada um mais barato de decifrar
   * e aplicar - sem qualquer mudanca para quem sincroniza normalmente.
   */
  private static readonly OPS_BATCH_SIZE = 200;

  private sendOps(peer: PeerConnection, serverId: string, ops: Operation[]): void {
    const key = this.store.serverKey(serverId);
    if (!key || ops.length === 0) return;
    for (let i = 0; i < ops.length; i += P2PNode.OPS_BATCH_SIZE) {
      const lote = ops.slice(i, i + P2PNode.OPS_BATCH_SIZE);
      this.send(peer, { t: 'ops', serverId, sealed: seal(key, JSON.stringify(lote)) });
    }
  }

  private handle(peer: PeerConnection, message: Message): void {
    switch (message.t) {
      case 'auth:challenge': {
        /*
         * So respondemos ao PRIMEIRO challenge desta conexao - o que o
         * handler de 'connection' ja manda sozinho ao conectar.
         *
         * Um segundo challenge na mesma conexao so existe se o outro lado
         * mandou de proposito, e o unico motivo para isso e um ataque de
         * reflexao: um intermediario (M) conectado a nos e a um terceiro (T)
         * ao mesmo tempo nos envia o nonce que T gerou para M, esperando que
         * assinemos; M entao repassa nossa assinatura a T, fazendo T
         * acreditar que esta falando diretamente conosco quando na verdade
         * fala com M no meio. Ignorar qualquer challenge alem do primeiro
         * fecha essa reflexao sem precisar inspecionar nada da camada de
         * transporte do Hyperswarm.
         */
        if (peer.answeredChallenge) break;
        peer.answeredChallenge = true;

        // Assina o nonce do outro lado para provar que temos a chave privada.
        if (typeof message.nonce !== 'string' || message.nonce.length > 128) break;
        this.send(peer, {
          t: 'auth:proof',
          publicKey: this.store.publicKeyHex,
          signature: Buffer.from(
            sign(authMessage(message.nonce), this.store.identity.privateKey),
          ).toString('hex'),
        });
        break;
      }

      case 'auth:proof': {
        if (!peer.challenge) break;
        if (!/^[0-9a-f]{64}$/.test(message.publicKey ?? '')) break;

        const valida = verify(
          fromHex(message.signature),
          authMessage(peer.challenge),
          fromHex(message.publicKey),
        );
        // Assinatura ruim: o peer nao e quem diz ser. Encerrar e mais seguro
        // que seguir com uma identidade desconhecida.
        if (!valida) {
          peer.socket.destroy();
          break;
        }

        peer.identityKey = message.publicKey;
        peer.challenge = null;

        /*
         * No maximo uma conexao viva por identidade.
         *
         * Nada limitava quantas conexoes simultaneas uma MESMA chave publica
         * podia abrir, e cada uma consome um socket e participa de
         * sincronizacao completa. Encerrar a conexao mais antiga ao
         * verificar uma nova (em vez de recusar a nova) favorece quem acabou
         * de reconectar - o caso normal - sobre uma conexao zumbi.
         */
        for (const outra of this.peers.values()) {
          if (outra.remoteKey !== peer.remoteKey && outra.identityKey === peer.identityKey) {
            outra.socket.destroy();
          }
        }

        this.announcePresenceTo(peer);
        this.send(peer, { t: 'hello', servers: this.readableServers() });
        this.flushInbox(peer);
        this.emit('peer:verified', peer.identityKey);
        break;
      }

      case 'friend:request': {
        if (!peer.identityKey) break;
        this.emit('friend:request', {
          from: peer.identityKey,
          displayName: String(message.displayName ?? '').slice(0, 64),
          avatar: typeof message.avatar === 'string' ? message.avatar : null,
        });
        break;
      }

      case 'friend:response': {
        if (!peer.identityKey) break;
        this.emit('friend:response', {
          from: peer.identityKey,
          accepted: message.accepted === true,
          displayName: String(message.displayName ?? '').slice(0, 64),
        });
        break;
      }

      case 'invite:offer': {
        if (!peer.identityKey) break;
        this.emit('invite:offer', {
          from: peer.identityKey,
          serverId: String(message.serverId ?? ''),
          serverName: String(message.serverName ?? '').slice(0, 64),
          code: String(message.code ?? ''),
        });
        break;
      }

      case 'hello': {
        // Identidade vem da prova, nunca do que o peer declara.
        if (!peer.identityKey) break;
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
        // Sincronizar custa CPU (decifra, reconstroi a projecao inteira do
        // lado de quem envia 'ops'). Sem exigir identidade provada, uma
        // conexao que nunca completa o desafio ja conseguia disparar isso -
        // bastava conhecer a chave do servidor, nem precisava provar quem e.
        if (!peer.identityKey) break;
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
        if (!peer.identityKey) break;
        if (!this.store.serverKey(message.serverId)) break;
        this.sendOps(
          peer,
          message.serverId,
          operationsMissingFor(this.store.operationsFor(message.serverId), message.heads),
        );
        break;
      }

      case 'ops': {
        if (!peer.identityKey) break;
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

        /*
         * O envelope (`message.serverId`) diz qual chave foi usada para
         * selar isto, mas cada operacao carrega o PROPRIO `serverId`
         * assinado - e nada antes conferia os dois contra o outro.
         *
         * Isso permitia um ataque entre servidores: alguem que e
         * administrador do PROPRIO servidor X podia assinar uma operacao
         * com `serverId: Y` (um servidor diferente, onde a vitima tambem
         * esta) e manda-la pelo canal de X. `applyRemoteOperations` confere
         * a permissao do autor EM Y - e como Y nao sabe que esta operacao
         * nunca passou pelo topico de Y, ela era aceita. Descartar aqui
         * qualquer operacao cujo serverId nao bate com o envelope fecha essa
         * porta na origem, antes mesmo do reducer entrar em cena.
         */
        const doServidorCerto = ops.filter((op) => op.serverId === message.serverId);

        // applyRemoteOperations valida assinatura, formato e permissao.
        const { accepted } = this.store.applyRemoteOperations(doServidorCerto);
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

      case 'presence': {
        const key = this.store.serverKey(message.serverId);
        if (!key || !peer.identityKey) break;

        const plaintext = open(key, message.sealed as SealedPayload);
        if (plaintext === null) break;

        let payload: PresencePayload;
        try {
          payload = JSON.parse(plaintext) as PresencePayload;
        } catch {
          break;
        }
        if (!isPresenceStatus(payload?.status)) break;

        // Um peer invisivel e tratado como offline: ele nao aparece na lista,
        // exatamente como se nao houvesse conexao.
        if (payload.status === 'INVISIBLE') {
          this.presence.delete(peer.identityKey);
        } else {
          const atual = this.presence.get(peer.identityKey);
          // Descarta anuncio mais antigo que o ultimo conhecido.
          if (atual && atual.at > Number(payload.at ?? 0)) break;
          this.presence.set(peer.identityKey, {
            status: payload.status,
            voice: typeof payload.voice === 'string' ? payload.voice : null,
            at: Number(payload.at ?? Date.now()),
          });
        }

        this.emit('presence:update', this.presenceSnapshot());
        break;
      }

      case 'call:invite': {
        if (!peer.identityKey) break;
        this.emit('call:invite', {
          from: peer.identityKey,
          callId: String(message.callId ?? ''),
          displayName: String(message.displayName ?? '').slice(0, 64),
          avatar: typeof message.avatar === 'string' ? message.avatar : null,
        });
        break;
      }

      case 'call:accept': {
        if (!peer.identityKey) break;
        this.emit('call:accept', { from: peer.identityKey, callId: String(message.callId ?? '') });
        break;
      }

      case 'call:decline': {
        if (!peer.identityKey) break;
        this.emit('call:decline', { from: peer.identityKey, callId: String(message.callId ?? '') });
        break;
      }

      case 'call:end': {
        if (!peer.identityKey) break;
        this.emit('call:end', { from: peer.identityKey, callId: String(message.callId ?? '') });
        break;
      }

      case 'call:signal': {
        // A identidade vem da prova, nunca do que a mensagem declara - mesma
        // regra da sinalizacao de servidor.
        if (!peer.identityKey) break;
        if (typeof message.callId !== 'string' || typeof message.kind !== 'string') break;
        this.emit('call:signal', {
          from: peer.identityKey,
          callId: message.callId,
          signal: {
            kind: message.kind,
            from: peer.identityKey,
            channelId: message.callId,
            data: message.data,
          } as VoiceSignal,
        });
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

  // ---------- chamada direta ----------

  /**
   * Toca o telefone de outra pessoa, com ou sem servidor em comum.
   *
   * Usa o mesmo caminho do pedido de amizade: se ela nao estiver conectada
   * agora, a mensagem espera na fila do topico pessoal dela ate aparecer.
   */
  callInvite(
    targetKey: string,
    callId: string,
    displayName: string,
    avatar: string | null,
  ): Promise<'entregue' | 'na-fila'> {
    return this.sendToUser(targetKey, { t: 'call:invite', callId, displayName, avatar });
  }

  async callRespond(targetKey: string, callId: string, accepted: boolean): Promise<void> {
    await this.sendToUser(targetKey, { t: accepted ? 'call:accept' : 'call:decline', callId });
  }

  async callEnd(targetKey: string, callId: string): Promise<void> {
    await this.sendToUser(targetKey, { t: 'call:end', callId });
  }

  /** Sinalizacao WebRTC de uma chamada direta - sem chave de servidor envolvida. */
  callSignal(targetKey: string, signal: VoiceSignal): void {
    void this.sendToUser(targetKey, {
      t: 'call:signal',
      callId: signal.channelId,
      kind: signal.kind,
      data: signal.data,
    });
  }

  // ---------- presenca ----------

  /**
   * Anuncia o proprio status para um peer.
   *
   * Vai cifrado com a chave de cada servidor em comum: quem nao participa do
   * servidor nao descobre que estamos online.
   */
  private announcePresenceTo(peer: PeerConnection): void {
    const payload: PresencePayload = {
      status: this.myStatus,
      voice: this.myVoiceChannel,
      at: Date.now(),
    };
    for (const { serverId, key } of this.store.knownServerKeys()) {
      this.send(peer, {
        t: 'presence',
        serverId,
        sealed: seal(key, JSON.stringify(payload)),
      });
    }
  }

  /** Troca o proprio status e avisa todos os peers conectados. */
  setStatus(status: PresenceStatus): void {
    this.myStatus = status;
    for (const peer of this.peers.values()) this.announcePresenceTo(peer);
  }

  getStatus(): PresenceStatus {
    return this.myStatus;
  }

  /** Anuncia entrada ou saida de um canal de voz. */
  setVoiceChannel(channelId: string | null): void {
    this.myVoiceChannel = channelId;
    for (const peer of this.peers.values()) this.announcePresenceTo(peer);
  }

  /** Quem esta online agora, por chave publica. */
  presenceSnapshot(): Record<string, PeerPresence> {
    const resultado: Record<string, PeerPresence> = {};
    for (const [key, valor] of this.presence) {
      resultado[key] = { status: valor.status, voice: valor.voice };
    }
    return resultado;
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
