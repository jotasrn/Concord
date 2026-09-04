import { ScreenStats, StatsReader, VoiceStats, VoiceTransport } from './VoiceTransport';
import {
  LATENCY_PROFILES,
  LatencyBreakdown,
  LatencyProfile,
  applyOpusLowLatency,
  readLatency,
  tuneAllReceivers,
} from './lowLatency';

export interface VideoEncodingOptions {
  maxBitrate: number;
  maxFramerate: number;
  degradationPreference: RTCDegradationPreference;
}

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
  /** Conta o tempo em disconnected antes de forcar a renegociacao. */
  recoveryTimer: ReturnType<typeof setTimeout> | null;
}

/** Quanto esperar a conexao voltar sozinha antes de reiniciar o ICE. */
const RECOVERY_DELAY_MS = 4000;

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
  private localVideoTrack: MediaStreamTrack | null = null;
  private systemAudioTrack: MediaStreamTrack | null = null;
  private videoOptions: VideoEncodingOptions | null = null;
  private latency: LatencyProfile = LATENCY_PROFILES.ultra;
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
      recoveryTimer: null,
    };

    if (this.localTrack) pc.addTrack(this.localTrack);
    if (this.localVideoTrack) {
      const transceiver = pc.addTransceiver(this.localVideoTrack, { direction: 'sendonly' });
      this.preferScreenCodecs(transceiver);
    }
    if (this.systemAudioTrack) pc.addTransceiver(this.systemAudioTrack, { direction: 'sendonly' });

    pc.ontrack = (event) => {
      for (const track of event.streams[0]?.getTracks() ?? [event.track]) {
        if (stream.getTracks().includes(track)) continue;

        /*
         * So 'ended' encerra a faixa de verdade.
         *
         * 'mute' NAO significa fim: em WebRTC ele dispara sempre que a midia
         * para de chegar por um instante - um engasgo de rede basta - e volta
         * com 'unmute'. Remover a faixa nesse evento matava a transmissao de
         * forma permanente ao primeiro soluco, e a imagem so voltava refazendo
         * a chamada.
         *
         * Os dois eventos apenas avisam a interface, que decide o que mostrar.
         */
        track.addEventListener('ended', () => {
          if (stream.getTracks().includes(track)) stream.removeTrack(track);
          this.events.onStream(peerKey, stream);
        });
        track.addEventListener('mute', () => this.events.onStream(peerKey, stream));
        track.addEventListener('unmute', () => this.events.onStream(peerKey, stream));

        stream.addTrack(track);
      }

      // Receptores so existem depois da midia chegar; e aqui que o alvo do
      // jitter buffer pode ser aplicado.
      tuneAllReceivers(pc, this.latency.jitterTarget);
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
        const offer = await pc.createOffer();
        offer.sdp = this.tuneSdp(offer.sdp);
        await pc.setLocalDescription(offer);
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
        // Falha definitiva: renegocia os candidatos imediatamente.
        void pc.restartIce();
        return;
      }

      /*
       * 'disconnected' e a armadilha: a conexao para de entregar midia mas
       * nunca chega a 'failed', entao nada se recupera sozinho e a imagem fica
       * congelada ate a chamada ser refeita.
       *
       * Damos um tempo para ela voltar por conta propria - o que costuma
       * acontecer em quedas curtas - e so entao forcamos a renegociacao.
       */
      if (pc.connectionState === 'disconnected') {
        if (entry.recoveryTimer) clearTimeout(entry.recoveryTimer);
        entry.recoveryTimer = setTimeout(() => {
          if (pc.connectionState === 'disconnected') void pc.restartIce();
        }, RECOVERY_DELAY_MS);
        return;
      }

      if (pc.connectionState === 'connected' && entry.recoveryTimer) {
        clearTimeout(entry.recoveryTimer);
        entry.recoveryTimer = null;
      }
    };

    this.peers.set(peerKey, entry);
    // Encoding precisa ser aplicado depois do sender existir.
    void this.applyVideoEncoding(entry);
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
        const answer = await entry.pc.createAnswer();
        answer.sdp = this.tuneSdp(answer.sdp);
        await entry.pc.setLocalDescription(answer);
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
    if (entry.recoveryTimer) clearTimeout(entry.recoveryTimer);
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

  /**
   * Publica a tela para todos os peers.
   *
   * Reusa o transceiver de video existente sempre que possivel: adicionar uma
   * track nova dispara renegociacao completa, enquanto replaceTrack troca a
   * midia sem interromper quem ja esta assistindo.
   */
  async addVideoTrack(track: MediaStreamTrack, options?: VideoEncodingOptions): Promise<void> {
    this.localVideoTrack = track;
    this.videoOptions = options ?? this.videoOptions;

    for (const entry of this.peers.values()) {
      const sender = entry.pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) {
        await sender.replaceTrack(track);
      } else {
        const transceiver = entry.pc.addTransceiver(track, { direction: 'sendonly' });
        this.preferScreenCodecs(transceiver);
      }
      await this.applyVideoEncoding(entry);
    }
  }

  /** Troca a fonte compartilhada sem renegociar nem piscar a imagem. */
  async replaceVideoTrack(track: MediaStreamTrack): Promise<void> {
    this.localVideoTrack = track;
    for (const entry of this.peers.values()) {
      const sender = entry.pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(track);
    }
  }

  /** Aplica bitrate, framerate e politica de degradacao no encoder. */
  async setVideoEncoding(options: VideoEncodingOptions): Promise<void> {
    this.videoOptions = options;
    for (const entry of this.peers.values()) await this.applyVideoEncoding(entry);
  }

  private async applyVideoEncoding(entry: PeerEntry): Promise<void> {
    const sender = entry.pc.getSenders().find((s) => s.track?.kind === 'video');
    if (!sender || !this.videoOptions) return;

    const parameters = sender.getParameters();
    if (!parameters.encodings || parameters.encodings.length === 0) {
      parameters.encodings = [{}];
    }

    parameters.encodings[0].maxBitrate = this.videoOptions.maxBitrate;
    parameters.encodings[0].maxFramerate = this.videoOptions.maxFramerate;
    // Decide o que ceder sob pressao: quadros ou nitidez.
    parameters.degradationPreference = this.videoOptions.degradationPreference;

    try {
      await sender.setParameters(parameters);
    } catch {
      // Navegador pode recusar combinacoes; a captura ja limita por cima.
    }
  }

  /**
   * Prioriza codecs bons em conteudo de tela.
   *
   * VP9 e AV1 codificam texto e areas estaticas muito melhor que VP8 e H264,
   * que foram desenhados para video de camera. A diferenca aparece justamente
   * em codigo e planilha, onde borrao e inaceitavel.
   */
  private preferScreenCodecs(transceiver: RTCRtpTransceiver): void {
    if (typeof RTCRtpSender.getCapabilities !== 'function') return;
    if (typeof transceiver.setCodecPreferences !== 'function') return;

    const capabilities = RTCRtpSender.getCapabilities('video');
    if (!capabilities) return;

    const rank = (mime: string): number => {
      const normalizado = mime.toLowerCase();
      if (normalizado.includes('av1')) return 0;
      if (normalizado.includes('vp9')) return 1;
      if (normalizado.includes('vp8')) return 2;
      if (normalizado.includes('h264')) return 3;
      return 4;
    };

    try {
      transceiver.setCodecPreferences(
        [...capabilities.codecs].sort((a, b) => rank(a.mimeType) - rank(b.mimeType)),
      );
    } catch {
      // Preferencia e otimizacao; falhar aqui nao impede a transmissao.
    }
  }

  /** Remove a track de video e renegocia com todos os peers. */
  async removeVideoTrack(): Promise<void> {
    this.localVideoTrack = null;
    for (const entry of this.peers.values()) {
      const sender = entry.pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) entry.pc.removeTrack(sender);
    }
  }

  /** Adiciona o audio do sistema como uma segunda faixa de audio. */
  async addSystemAudioTrack(track: MediaStreamTrack): Promise<void> {
    this.systemAudioTrack = track;
    for (const entry of this.peers.values()) {
      entry.pc.addTransceiver(track, { direction: 'sendonly' });
    }
  }

  async removeSystemAudioTrack(): Promise<void> {
    const track = this.systemAudioTrack;
    if (!track) return;
    for (const entry of this.peers.values()) {
      const sender = entry.pc.getSenders().find((s) => s.track === track);
      if (sender) entry.pc.removeTrack(sender);
    }
    this.systemAudioTrack = null;
  }

  /** Metricas de video do que ESTAMOS enviando, para o painel de diagnostico. */
  async getOutboundVideoStats(): Promise<ScreenStats | null> {
    const entry = [...this.peers.values()][0];
    if (!entry) return null;
    return this.stats.readOutboundVideo(entry.pc);
  }

  async disconnect(): Promise<void> {
    if (this.channelId) this.send({ kind: 'leave', channelId: this.channelId });
    for (const key of [...this.peers.keys()]) this.removePeer(key);
    this.stats.reset();
    this.channelId = null;
    this.localTrack = null;
    this.localVideoTrack = null;
    this.systemAudioTrack = null;
  }

  /** Ajusta o perfil de latencia em todas as conexoes ativas. */
  setLatencyProfile(profile: LatencyProfile): void {
    this.latency = profile;
    for (const entry of this.peers.values()) {
      tuneAllReceivers(entry.pc, profile.jitterTarget);
    }
  }

  getLatencyProfile(): LatencyProfile {
    return this.latency;
  }

  private tuneSdp(sdp: string | undefined): string | undefined {
    return sdp ? applyOpusLowLatency(sdp, this.latency.ptime) : sdp;
  }

  /** Latencia medida por peer, a partir do relatorio do WebRTC. */
  async getLatency(): Promise<Map<string, LatencyBreakdown>> {
    const resultado = new Map<string, LatencyBreakdown>();
    for (const [key, entry] of this.peers) {
      resultado.set(key, readLatency(await entry.pc.getStats()));
    }
    return resultado;
  }

  /**
   * Forca a renegociacao com todos os peers.
   *
   * Saida manual para quando a imagem trava e a recuperacao automatica ainda
   * nao agiu - evita ter que sair e voltar da chamada, que era a unica opcao.
   */
  async reconnectAll(): Promise<void> {
    for (const entry of this.peers.values()) {
      if (entry.recoveryTimer) {
        clearTimeout(entry.recoveryTimer);
        entry.recoveryTimer = null;
      }
      try {
        entry.pc.restartIce();
      } catch {
        // Um peer que falha nao impede os demais de reconectar.
      }
    }
    // Reanuncia a presenca: quem nao respondeu ao ICE restart recria a conexao.
    if (this.channelId) this.send({ kind: 'join', channelId: this.channelId });
  }

  peerKeys(): string[] {
    return [...this.peers.keys()];
  }
}
