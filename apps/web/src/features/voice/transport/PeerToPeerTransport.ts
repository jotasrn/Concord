import { ScreenStats, StatsReader, VoiceStats, VoiceTransport } from './VoiceTransport';
import {
  LATENCY_PROFILES,
  LatencyBreakdown,
  LatencyProfile,
  OPUS_BITRATE_BPS,
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
  /** Faixas de audio do peer (microfone e, quando houver, audio do sistema). */
  onAudio: (peerKey: string, stream: MediaStream) => void;
  /**
   * Tela do peer. `null` quando ele parou de transmitir.
   *
   * Cada faixa recebida vira um MediaStream novo: a identidade do objeto muda,
   * e e isso que faz o elemento <video> do React se reconectar.
   */
  onScreen: (peerKey: string, stream: MediaStream | null) => void;
  /** O peer congelou a propria transmissao. A imagem para, a conexao nao. */
  onScreenPaused: (peerKey: string, paused: boolean) => void;
  onPeerLeft: (peerKey: string) => void;
  onConnectionChange: (peerKey: string, state: RTCPeerConnectionState) => void;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  /** Somente audio. Nunca e recriado, para nao interromper a reproducao. */
  audioStream: MediaStream;
  /** Tela recebida, se houver. */
  screenStream: MediaStream | null;
  /**
   * Lado "polite" cede em colisao de offers. Definido comparando as chaves
   * publicas, o que da a mesma resposta nos dois lados sem negociacao extra.
   */
  polite: boolean;
  makingOffer: boolean;
  /**
   * Offer ignorada por ser lado impolite: os candidates que chegam depois dela
   * pertencem a uma descricao que nunca foi aplicada e precisam ser
   * descartados, senao viram erro a cada um.
   */
  ignoringOffer: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  /** Conta o tempo em disconnected antes de forcar a renegociacao. */
  recoveryTimer: ReturnType<typeof setTimeout> | null;
  /**
   * Transceivers que NOS usamos para enviar. Guardados para reaproveitar em
   * vez de criar m-lines novas a cada inicio de transmissao.
   */
  micTransceiver: RTCRtpTransceiver | null;
  videoTransceiver: RTCRtpTransceiver | null;
  systemAudioTransceiver: RTCRtpTransceiver | null;
  /** O peer disse que esta transmitindo. Base para detectar tela que nao chegou. */
  remoteSharing: boolean;
  /** Timer da checagem "ele disse que transmite mas nada chegou". */
  resendTimer: ReturnType<typeof setTimeout> | null;
  /**
   * Fila de sinalizacao. Um unico encadeamento de promessas por peer.
   *
   * Sem isto, dois sinais que chegam juntos entram em handleSignal ao mesmo
   * tempo e se atropelam nos `await`: setRemoteDescription roda duas vezes
   * seguidas, o estado da negociacao quebra e a conexao fica parada ate a
   * chamada ser refeita. Era exatamente o que acontecia quando duas pessoas
   * comecavam a transmitir tela: muitos sinais de uma vez.
   */
  queue: Promise<void>;
}

/** Quanto esperar a conexao voltar sozinha antes de reiniciar o ICE. */
const RECOVERY_DELAY_MS = 4000;

/**
 * Prazo entre "ele avisou que esta transmitindo" e concluir que a tela nao vai
 * chegar. Precisa caber uma negociacao completa com folga.
 */
const ESPERA_TELA_MS = 5000;

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

    const entry: PeerEntry = {
      pc,
      audioStream: new MediaStream(),
      screenStream: null,
      // Ordem lexicografica das chaves decide quem cede - deterministico e
      // oposto nos dois lados.
      polite: this.selfKey < peerKey,
      makingOffer: false,
      ignoringOffer: false,
      pendingCandidates: [],
      recoveryTimer: null,
      micTransceiver: null,
      videoTransceiver: null,
      systemAudioTransceiver: null,
      remoteSharing: false,
      resendTimer: null,
      queue: Promise.resolve(),
    };

    if (this.localTrack) {
      entry.micTransceiver = pc.addTransceiver(this.localTrack, { direction: 'sendrecv' });
    }
    if (this.localVideoTrack) {
      entry.videoTransceiver = pc.addTransceiver(this.localVideoTrack, { direction: 'sendonly' });
      this.preferScreenCodecs(entry.videoTransceiver);
    }
    if (this.systemAudioTrack) {
      entry.systemAudioTransceiver = pc.addTransceiver(this.systemAudioTrack, {
        direction: 'sendonly',
      });
    }

    pc.ontrack = (event) => {
      const track = event.track;

      if (track.kind === 'video') {
        /*
         * Tela do peer, em stream proprio.
         *
         * Antes audio e video iam para o MESMO MediaStream. Isso causava dois
         * problemas: cada mudanca no video reatribuia o srcObject do elemento
         * de audio (estalo audivel no meio da conversa), e o objeto de stream
         * nunca trocava de identidade, entao o React nao tinha como perceber
         * que a tela mudou.
         */
        const screen = new MediaStream([track]);
        entry.screenStream = screen;
        // A faixa chegando ja e prova de transmissao: o aviso 'state' pode vir
        // depois, ou nem vir se tiver se perdido.
        entry.remoteSharing = true;

        track.addEventListener('ended', () => {
          if (entry.screenStream !== screen) return;
          entry.screenStream = null;
          entry.remoteSharing = false;
          this.events.onScreen(peerKey, null);
        });

        /*
         * 'mute' NAO e tratado aqui de proposito. Ele dispara em qualquer
         * interrupcao momentanea - um engasgo de rede basta - e usa-lo para
         * esconder a tela fazia a transmissao desaparecer ao primeiro soluco.
         * Quem manda em "esta ou nao transmitindo" e o sinal 'state', enviado
         * explicitamente por quem transmite.
         */
        this.events.onScreen(peerKey, screen);
      } else {
        if (!entry.audioStream.getTracks().includes(track)) {
          entry.audioStream.addTrack(track);
        }
        track.addEventListener('ended', () => {
          if (entry.audioStream.getTracks().includes(track)) {
            entry.audioStream.removeTrack(track);
          }
          this.events.onAudio(peerKey, entry.audioStream);
        });
        this.events.onAudio(peerKey, entry.audioStream);
      }

      // Receptores so existem depois da midia chegar; e aqui que o alvo do
      // jitter buffer pode ser aplicado.
      tuneAllReceivers(pc, this.latency.jitterTarget);
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

    // A renegociacao entra na MESMA fila dos sinais recebidos: criar uma offer
    // enquanto uma descricao remota esta sendo aplicada e a receita da colisao.
    pc.onnegotiationneeded = () => this.enqueue(entry, () => this.negotiate(peerKey, entry));

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
    void this.applyAudioEncoding(entry);
    return entry;
  }

  /**
   * Encadeia um passo de sinalizacao na fila do peer.
   *
   * Erros sao contidos aqui: um sinal malformado de um peer nao pode derrubar
   * a negociacao com os outros nem deixar uma promessa rejeitada solta.
   */
  private enqueue(entry: PeerEntry, step: () => Promise<void>): void {
    entry.queue = entry.queue.then(step).catch(() => undefined);
  }

  /**
   * Pede a tela de novo quando o peer diz que transmite e nada chegou.
   *
   * A espera existe porque o aviso 'state' costuma chegar antes da offer que
   * carrega a faixa - pedir na hora geraria uma renegociacao inutil em toda
   * transmissao iniciada.
   */
  private agendarChecagemDeTela(peerKey: string, entry: PeerEntry): void {
    if (entry.resendTimer) clearTimeout(entry.resendTimer);
    entry.resendTimer = setTimeout(() => {
      entry.resendTimer = null;
      if (!entry.remoteSharing || entry.screenStream || !this.channelId) return;
      this.send({
        kind: 'state',
        to: peerKey,
        channelId: this.channelId,
        data: { resend: true },
      });
    }, ESPERA_TELA_MS);
  }

  /**
   * Cria e envia uma offer.
   *
   * `forcar` acrescenta reinicio de ICE: e usado quando o outro lado avisa que
   * nao esta recebendo a tela. Nesse caso o SDP normalmente ja esta correto e o
   * que faltou foi o caminho de midia, entao repetir a mesma offer nao
   * resolveria - o que resolve e refazer os candidatos.
   */
  private async negotiate(peerKey: string, entry: PeerEntry, forcar = false): Promise<void> {
    if (!this.channelId) return;
    // A fila serializa, mas a offer pode ter ficado obsoleta na espera.
    if (entry.pc.signalingState !== 'stable') return;
    try {
      entry.makingOffer = true;
      const offer = await entry.pc.createOffer(forcar ? { iceRestart: true } : undefined);
      offer.sdp = this.tuneSdp(offer.sdp);
      await entry.pc.setLocalDescription(offer);
      this.send({
        kind: 'offer',
        to: peerKey,
        channelId: this.channelId,
        data: entry.pc.localDescription?.toJSON(),
      });
    } catch {
      // Renegociacao falha nao deve derrubar a chamada inteira.
    } finally {
      entry.makingOffer = false;
    }
  }

  /**
   * Trata um sinal recebido pela camada P2P.
   *
   * Aqui so entra o enfileiramento: o trabalho fica em applySignal, que roda um
   * sinal por vez para cada peer.
   */
  async handleSignal(signal: {
    kind: string;
    from: string;
    channelId: string;
    data?: unknown;
  }): Promise<void> {
    if (signal.channelId !== this.channelId || signal.from === this.selfKey) return;

    // 'leave' nao espera a fila: se o peer saiu, o que esta enfileirado para
    // ele perdeu sentido.
    if (signal.kind === 'leave') {
      this.removePeer(signal.from);
      return;
    }

    const entry = this.createPeer(signal.from);
    this.enqueue(entry, () => this.applySignal(entry, signal));
  }

  private async applySignal(
    entry: PeerEntry,
    signal: { kind: string; from: string; channelId: string; data?: unknown },
  ): Promise<void> {
    switch (signal.kind) {
      case 'join': {
        /*
         * Alguem entrou. A conexao ja foi criada por handleSignal, o que
         * dispara negotiationneeded sozinho.
         *
         * Se ja estamos transmitindo, contamos: quem acabou de chegar nao
         * presenciou o 'state' anterior e ficaria sem saber que ha uma tela.
         */
        if (this.localVideoTrack && this.channelId) {
          this.send({
            kind: 'state',
            to: signal.from,
            channelId: this.channelId,
            data: { sharing: true },
          });
        }
        break;
      }

      case 'state': {
        const data = signal.data as
          | { sharing?: boolean; paused?: boolean; resend?: boolean }
          | null;
        if (!data) return;

        /*
         * O outro lado avisou que nao recebeu nossa tela.
         *
         * replaceTrack numa m-line que ja existe nao dispara
         * negotiationneeded, entao se aquela negociacao se perdeu no caminho
         * nada a refaria sozinho - era exatamente o caso de "ele esta
         * transmitindo e eu nao vejo nada, tenho que sair e entrar".
         */
        if (data.resend) {
          if (this.localVideoTrack) await this.negotiate(signal.from, entry, true);
          return;
        }

        if (typeof data.paused === 'boolean') {
          this.events.onScreenPaused(signal.from, data.paused);
        }

        if (typeof data.sharing !== 'boolean') return;

        if (data.sharing) {
          entry.remoteSharing = true;
          // A tela em si chega por ontrack; se ja chegou, reafirma.
          if (entry.screenStream) this.events.onScreen(signal.from, entry.screenStream);
          this.agendarChecagemDeTela(signal.from, entry);
        } else {
          entry.remoteSharing = false;
          if (entry.resendTimer) {
            clearTimeout(entry.resendTimer);
            entry.resendTimer = null;
          }
          /*
           * screenStream NAO e descartado aqui.
           *
           * Parar de transmitir e replaceTrack(null): a faixa do outro lado
           * apenas emudece, ela nao termina. Se ela fosse esquecida agora, uma
           * segunda transmissao nao geraria ontrack nenhum - a mesma faixa
           * voltaria a receber quadros e nao haveria stream para mostrar.
           * Quem manda na visibilidade e remoteSharing; a faixa so e esquecida
           * quando termina de verdade ('ended').
           */
          this.events.onScreen(signal.from, null);
        }
        break;
      }

      case 'offer': {
        const description = signal.data as RTCSessionDescriptionInit;
        if (!description?.sdp) return;

        // Perfect negotiation: em colisao, o lado impolite ignora a offer.
        const colisao = entry.makingOffer || entry.pc.signalingState !== 'stable';
        entry.ignoringOffer = colisao && !entry.polite;
        if (entry.ignoringOffer) return;

        // Em colisao do lado polite, setRemoteDescription faz o rollback
        // implicito da nossa propria offer.
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
        // Faixas novas podem ter aparecido nesta negociacao.
        await this.applyVideoEncoding(entry);
        break;
      }

      case 'answer': {
        if (entry.pc.signalingState !== 'have-local-offer') return;
        await entry.pc.setRemoteDescription(signal.data as RTCSessionDescriptionInit);
        await this.flushCandidates(entry);
        await this.applyVideoEncoding(entry);
        break;
      }

      case 'ice': {
        const candidate = signal.data as RTCIceCandidateInit;
        // Candidates de uma offer que decidimos ignorar nao tem descricao onde
        // encaixar.
        if (entry.ignoringOffer) return;
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
    if (entry.resendTimer) clearTimeout(entry.resendTimer);
    entry.pc.close();
    this.peers.delete(peerKey);
    this.stats.reset(peerKey);
    this.events.onPeerLeft(peerKey);
  }

  getRemoteStreams(): Map<string, MediaStream> {
    return new Map([...this.peers].map(([key, entry]) => [key, entry.audioStream]));
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
      const sender = entry.micTransceiver?.sender;
      if (sender) await sender.replaceTrack(track);
    }
  }

  /**
   * Publica a tela para todos os peers.
   *
   * Reusa o transceiver de video quando ele existe: adicionar uma m-line nova
   * a cada inicio de transmissao acumula secoes mortas no SDP e obriga uma
   * renegociacao completa, enquanto replaceTrack troca a midia na hora.
   */
  async addVideoTrack(track: MediaStreamTrack, options?: VideoEncodingOptions): Promise<void> {
    this.localVideoTrack = track;
    this.videoOptions = options ?? this.videoOptions;

    for (const entry of this.peers.values()) {
      if (entry.videoTransceiver) {
        await entry.videoTransceiver.sender.replaceTrack(track);
        // Voltar de 'inactive' (deixado por removeVideoTrack) exige dizer de
        // novo que esta m-line envia.
        if (entry.videoTransceiver.direction !== 'sendonly') {
          entry.videoTransceiver.direction = 'sendonly';
        }
      } else {
        entry.videoTransceiver = entry.pc.addTransceiver(track, { direction: 'sendonly' });
        this.preferScreenCodecs(entry.videoTransceiver);
      }
      await this.applyVideoEncoding(entry);
    }

    this.announceSharing(true);
  }

  /** Troca a fonte compartilhada sem renegociar nem piscar a imagem. */
  async replaceVideoTrack(track: MediaStreamTrack): Promise<void> {
    this.localVideoTrack = track;
    for (const entry of this.peers.values()) {
      const sender = entry.videoTransceiver?.sender;
      if (sender) await sender.replaceTrack(track);
    }
  }

  /** Aplica bitrate, framerate e politica de degradacao no encoder. */
  async setVideoEncoding(options: VideoEncodingOptions): Promise<void> {
    this.videoOptions = options;
    for (const entry of this.peers.values()) await this.applyVideoEncoding(entry);
  }

  private async applyVideoEncoding(entry: PeerEntry): Promise<void> {
    const sender = entry.videoTransceiver?.sender;
    if (!sender || !sender.track || !this.videoOptions) return;

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
   * Reserva banda e prioridade de rede para a voz.
   *
   * Sem teto explicito o Chromium fica perto de 32 kbps em mono, e quando uma
   * transmissao de tela divide o mesmo caminho o audio e o primeiro a apertar:
   * a voz fica metalica justamente durante o compartilhamento. O bitrate
   * declarado aqui, junto com a prioridade alta, mantem a voz na frente.
   */
  private async applyAudioEncoding(entry: PeerEntry): Promise<void> {
    const sender = entry.micTransceiver?.sender;
    if (!sender) return;

    const parameters = sender.getParameters();
    if (!parameters.encodings || parameters.encodings.length === 0) {
      parameters.encodings = [{}];
    }
    parameters.encodings[0].maxBitrate = OPUS_BITRATE_BPS;
    parameters.encodings[0].networkPriority = 'high';
    parameters.encodings[0].priority = 'high';

    try {
      await sender.setParameters(parameters);
    } catch {
      // Nem todo navegador aceita priority; o bitrate do SDP ja garante o piso.
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

  /**
   * Para de transmitir a tela.
   *
   * Solta a faixa mas mantem o transceiver para a proxima vez. Como
   * replaceTrack(null) nao encerra a faixa do outro lado - ela apenas fica
   * muda, com o ultimo quadro congelado na tela - o aviso de que a transmissao
   * acabou vai explicito no sinal 'state'.
   */
  async removeVideoTrack(): Promise<void> {
    this.localVideoTrack = null;
    this.announceSharing(false);
    for (const entry of this.peers.values()) {
      const transceiver = entry.videoTransceiver;
      if (!transceiver) continue;
      try {
        await transceiver.sender.replaceTrack(null);
      } catch {
        // Conexao ja fechada: nada a desfazer.
      }
    }
  }

  /** Avisa os peers que comecamos ou paramos de transmitir. */
  private announceSharing(sharing: boolean): void {
    if (!this.channelId) return;
    this.send({ kind: 'state', channelId: this.channelId, data: { sharing } });
  }

  /**
   * Avisa que congelamos a imagem.
   *
   * Sem este aviso, quem assiste ve a tela parada e nao tem como distinguir
   * pausa de travamento - e a reacao natural e sair e voltar da chamada.
   */
  announcePaused(paused: boolean): void {
    if (!this.channelId) return;
    this.send({ kind: 'state', channelId: this.channelId, data: { paused } });
  }

  /** Adiciona o audio do sistema como uma segunda faixa de audio. */
  async addSystemAudioTrack(track: MediaStreamTrack): Promise<void> {
    this.systemAudioTrack = track;
    for (const entry of this.peers.values()) {
      // Reusa o transceiver: chamar addTransceiver a cada transmissao
      // acumulava m-lines de audio mortas no SDP.
      if (entry.systemAudioTransceiver) {
        await entry.systemAudioTransceiver.sender.replaceTrack(track);
        if (entry.systemAudioTransceiver.direction !== 'sendonly') {
          entry.systemAudioTransceiver.direction = 'sendonly';
        }
      } else {
        entry.systemAudioTransceiver = entry.pc.addTransceiver(track, { direction: 'sendonly' });
      }
    }
  }

  async removeSystemAudioTrack(): Promise<void> {
    if (!this.systemAudioTrack) return;
    for (const entry of this.peers.values()) {
      try {
        await entry.systemAudioTransceiver?.sender.replaceTrack(null);
      } catch {
        // idem
      }
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
    // E reafirma a transmissao, para quem recriou a conexao saber dela.
    if (this.localVideoTrack) this.announceSharing(true);
  }

  peerKeys(): string[] {
    return [...this.peers.keys()];
  }
}
