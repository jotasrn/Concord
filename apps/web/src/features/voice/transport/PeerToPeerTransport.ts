import { StatsReader, VoiceStats, VoiceTransport } from './VoiceTransport';

export interface SignalSender {
  (signal: {
    kind: 'join' | 'leave' | 'offer' | 'answer' | 'ice' | 'state';
    to?: string;
    channelId: string;
    data?: unknown;
  }): void;
}

export interface PeerEvents {
  onStream: (peerKey: string, stream: MediaStream) => void;
  onPeerLeft: (peerKey: string) => void;
  onConnectionChange: (peerKey: string, state: RTCPeerConnectionState) => void;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  stream: MediaStream;
  /**
   * Lado "polite" cede em colisao de offers. Definido comparando as chaves
   * publicas, o que da a mesma resposta nos dois lados sem negociacao extra.
   */
  polite: boolean;
  makingOffer: boolean;
  pendingCandidates: RTCIceCandidateInit[];
}

/**
 * Malha P2P: uma RTCPeerConnection por participante.
 *
 * A sinalizacao viaja pela conexao Hyperswarm ja estabelecida e cifrada, entao
 * nao ha servidor de signaling. STUN publico resolve a maioria dos NATs; sem
 * TURN, combinacoes hostis de NAT simetrico ainda podem falhar.
 */
export class PeerToPeerTransport implements VoiceTransport {
  readonly kind = 'p2p' as const;

  private readonly peers = new Map<string, PeerEntry>();
  private readonly stats = new StatsReader();
  private localTrack: MediaStreamTrack | null = null;
  private channelId: string | null = null;

  constructor(
    private readonly selfKey: string,
    private readonly send: SignalSender,
    private readonly events: PeerEvents,
    private readonly iceServers: RTCIceServer[] = [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    ],
  ) {}

  async connect(channelId: string, localTrack: MediaStreamTrack): Promise<void> {
    this.channelId = channelId;
    this.localTrack = localTrack;
    // Anuncia presenca: quem ja estiver no canal respondera com offer.
    this.send({ kind: 'join', channelId });
  }

  private createPeer(peerKey: string): PeerEntry {
    const existing = this.peers.get(peerKey);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const stream = new MediaStream();

    const entry: PeerEntry = {
      pc,
      stream,
      // Ordem lexicografica das chaves decide quem cede - deterministico e
      // oposto nos dois lados.
      polite: this.selfKey < peerKey,
      makingOffer: false,
      pendingCandidates: [],
    };

    if (this.localTrack) pc.addTrack(this.localTrack);

    pc.ontrack = (event) => {
      for (const track of event.streams[0]?.getTracks() ?? [event.track]) {
        if (!stream.getTracks().includes(track)) stream.addTrack(track);
      }
      this.events.onStream(peerKey, stream);
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate || !this.channelId) return;
      this.send({
        kind: 'ice',
        to: peerKey,
        channelId: this.channelId,
        data: event.candidate.toJSON(),
      });
    };

    pc.onnegotiationneeded = async () => {
      if (!this.channelId) return;
      try {
        entry.makingOffer = true;
        await pc.setLocalDescription();
        this.send({
          kind: 'offer',
          to: peerKey,
          channelId: this.channelId,
          data: pc.localDescription?.toJSON(),
        });
      } catch {
        // Renegociacao falha nao deve derrubar a chamada inteira.
      } finally {
        entry.makingOffer = false;
      }
    };

    pc.onconnectionstatechange = () => {
      this.events.onConnectionChange(peerKey, pc.connectionState);
      if (pc.connectionState === 'failed') {
        // ICE restart: rede mudou (wifi -> cabo, troca de IP).
        void pc.restartIce();
      }
    };

    this.peers.set(peerKey, entry);
    return entry;
  }

  /** Trata um sinal recebido pela camada P2P. */
  async handleSignal(signal: {
    kind: string;
    from: string;
    channelId: string;
    data?: unknown;
  }): Promise<void> {
    if (signal.channelId !== this.channelId || signal.from === this.selfKey) return;

    switch (signal.kind) {
      case 'join': {
        // Alguem entrou: criamos a conexao, o que dispara negotiationneeded.
        this.createPeer(signal.from);
        break;
      }

      case 'offer': {
        const entry = this.createPeer(signal.from);
        const description = signal.data as RTCSessionDescriptionInit;

        // Perfect negotiation: em colisao, o lado impolite ignora a offer.
        const colisao =
          entry.makingOffer || entry.pc.signalingState !== 'stable';
        if (colisao && !entry.polite) return;

        await entry.pc.setRemoteDescription(description);
        await this.flushCandidates(entry);
        await entry.pc.setLocalDescription();
        this.send({
          kind: 'answer',
          to: signal.from,
          channelId: signal.channelId,
          data: entry.pc.localDescription?.toJSON(),
        });
        break;
      }

      case 'answer': {
        const entry = this.peers.get(signal.from);
        if (!entry || entry.pc.signalingState !== 'have-local-offer') return;
        await entry.pc.setRemoteDescription(signal.data as RTCSessionDescriptionInit);
        await this.flushCandidates(entry);
        break;
      }

      case 'ice': {
        const entry = this.peers.get(signal.from);
        const candidate = signal.data as RTCIceCandidateInit;
        if (!entry) return;
        // Candidates podem chegar antes da descricao remota; guardamos ate la.
        if (!entry.pc.remoteDescription) {
          entry.pendingCandidates.push(candidate);
          return;
        }
        try {
          await entry.pc.addIceCandidate(candidate);
        } catch {
          // Candidate invalido de um peer nao invalida a conexao.
        }
        break;
      }

      case 'leave': {
        this.removePeer(signal.from);
        break;
      }
    }
  }

  private async flushCandidates(entry: PeerEntry): Promise<void> {
    const pendentes = entry.pendingCandidates.splice(0);
    for (const candidate of pendentes) {
      try {
        await entry.pc.addIceCandidate(candidate);
      } catch {
        // idem
      }
    }
  }

  private removePeer(peerKey: string): void {
    const entry = this.peers.get(peerKey);
    if (!entry) return;
    entry.pc.close();
    this.peers.delete(peerKey);
    this.stats.reset(peerKey);
    this.events.onPeerLeft(peerKey);
  }

  getRemoteStreams(): Map<string, MediaStream> {
    return new Map([...this.peers].map(([key, entry]) => [key, entry.stream]));
  }

  async getStats(): Promise<Map<string, VoiceStats>> {
    const resultado = new Map<string, VoiceStats>();
    for (const [key, entry] of this.peers) {
      resultado.set(key, await this.stats.read(entry.pc, key));
    }
    return resultado;
  }

  /** Troca o microfone sem renegociar a sessao. */
  async replaceTrack(track: MediaStreamTrack): Promise<void> {
    this.localTrack = track;
    for (const entry of this.peers.values()) {
      const sender = entry.pc.getSenders().find((s) => s.track?.kind === 'audio');
      if (sender) await sender.replaceTrack(track);
    }
  }

  async disconnect(): Promise<void> {
    if (this.channelId) this.send({ kind: 'leave', channelId: this.channelId });
    for (const key of [...this.peers.keys()]) this.removePeer(key);
    this.stats.reset();
    this.channelId = null;
    this.localTrack = null;
  }

  peerKeys(): string[] {
    return [...this.peers.keys()];
  }
}
