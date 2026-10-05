export interface VoiceStats {
  /** Round-trip time em ms, do candidate pair ativo. */
  rttMs: number | null;
  jitterMs: number | null;
  packetLossPercent: number | null;
  audioBitrateKbps: number | null;
  codec: string | null;
  sampleRate: number | null;
  channels: number | null;
  /**
   * Amostras sinteticas geradas pelo jitter buffer para cobrir pacotes
   * perdidos. Sobe quando a rede esta ruim.
   */
  concealedSamples: number | null;
  quality: 'excelente' | 'media' | 'ruim' | 'desconhecida';
}

export const EMPTY_STATS: VoiceStats = {
  rttMs: null,
  jitterMs: null,
  packetLossPercent: null,
  audioBitrateKbps: null,
  codec: null,
  sampleRate: null,
  channels: null,
  concealedSamples: null,
  quality: 'desconhecida',
};

/**
 * Contrato de transporte de voz.
 *
 * O MVP usa malha P2P. Um SFUTransport implementa a mesma interface, entao a
 * camada de audio (AudioEngine, VAD, medidores) nao muda quando a topologia
 * mudar.
 */
export interface VoiceTransport {
  readonly kind: 'p2p' | 'sfu';
  connect(channelId: string, localTrack: MediaStreamTrack): Promise<void>;
  disconnect(): Promise<void>;
  /** Streams remotos por chave publica do peer. */
  getRemoteStreams(): Map<string, MediaStream>;
  /** Metricas reais vindas de getStats(), nunca estimadas. */
  getStats(): Promise<Map<string, VoiceStats>>;
  replaceTrack(track: MediaStreamTrack): Promise<void>;
  /**
   * Adiciona uma track de video (ex: captura de tela) a todas as conexoes
   * ativas. A renegociacao e disparada automaticamente via onnegotiationneeded.
   */
  addVideoTrack(track: MediaStreamTrack): Promise<void>;
  /** Remove a track de video e renegocia. */
  removeVideoTrack(): Promise<void>;
}

interface StatsSnapshot {
  bytes: number;
  timestamp: number;
}

/**
 * Le RTCStatsReport e extrai metricas de audio.
 *
 * Bitrate nao existe pronto no relatorio: e derivado da diferenca de bytes
 * entre duas leituras, entao a primeira chamada sempre devolve null.
 */
export class StatsReader {
  private previous = new Map<string, StatsSnapshot>();

  async read(pc: RTCPeerConnection, peerId: string): Promise<VoiceStats> {
    const report = await pc.getStats();
    const stats: VoiceStats = { ...EMPTY_STATS };

    let inboundBytes: number | null = null;
    let reportTimestamp = 0;
    let packetsReceived = 0;
    let packetsLost = 0;
    let codecId: string | null = null;
    const codecs = new Map<
      string,
      RTCStats & { mimeType?: string; clockRate?: number; channels?: number }
    >();

    report.forEach((entry) => {
      if (entry.type === 'codec') {
        codecs.set(entry.id, entry as never);
      }
    });

    report.forEach((entry) => {
      const stat = entry as never as Record<string, number | string | undefined>;

      if (entry.type === 'inbound-rtp' && stat.kind === 'audio') {
        inboundBytes = Number(stat.bytesReceived ?? 0);
        reportTimestamp = Number(entry.timestamp);
        packetsReceived = Number(stat.packetsReceived ?? 0);
        packetsLost = Number(stat.packetsLost ?? 0);
        if (stat.jitter !== undefined) stats.jitterMs = Number(stat.jitter) * 1000;
        if (stat.concealedSamples !== undefined) {
          stats.concealedSamples = Number(stat.concealedSamples);
        }
        if (typeof stat.codecId === 'string') codecId = stat.codecId;
      }

      if (entry.type === 'candidate-pair' && stat.state === 'succeeded' && stat.nominated) {
        if (stat.currentRoundTripTime !== undefined) {
          stats.rttMs = Number(stat.currentRoundTripTime) * 1000;
        }
      }
    });

    if (codecId) {
      const codec = codecs.get(codecId) as
        { mimeType?: string; clockRate?: number; channels?: number } | undefined;
      if (codec) {
        stats.codec = codec.mimeType?.replace('audio/', '') ?? null;
        stats.sampleRate = codec.clockRate ?? null;
        stats.channels = codec.channels ?? null;
      }
    }

    const totalPackets = packetsReceived + packetsLost;
    if (totalPackets > 0) {
      stats.packetLossPercent = (packetsLost / totalPackets) * 100;
    }

    if (inboundBytes !== null) {
      const prev = this.previous.get(peerId);
      if (prev && reportTimestamp > prev.timestamp) {
        const deltaBits = (inboundBytes - prev.bytes) * 8;
        const deltaSeconds = (reportTimestamp - prev.timestamp) / 1000;
        if (deltaSeconds > 0) stats.audioBitrateKbps = deltaBits / deltaSeconds / 1000;
      }
      this.previous.set(peerId, { bytes: inboundBytes, timestamp: reportTimestamp });
    }

    stats.quality = classifyQuality(stats);
    return stats;
  }

  private previousVideo: StatsSnapshot | null = null;

  /**
   * Metricas do video que estamos ENVIANDO. Bitrate nao existe pronto no
   * relatorio: sai da diferenca de bytes entre duas leituras, entao a
   * primeira chamada devolve null nesse campo.
   */
  async readOutboundVideo(pc: RTCPeerConnection): Promise<ScreenStats> {
    const report = await pc.getStats();
    const stats: ScreenStats = { ...EMPTY_SCREEN_STATS };

    const codecs = new Map<string, { mimeType?: string }>();
    report.forEach((entry) => {
      if (entry.type === 'codec') codecs.set(entry.id, entry as never);
    });

    report.forEach((entry) => {
      const stat = entry as never as Record<string, number | string | undefined>;
      if (entry.type !== 'outbound-rtp' || stat.kind !== 'video') return;

      stats.width = stat.frameWidth !== undefined ? Number(stat.frameWidth) : null;
      stats.height = stat.frameHeight !== undefined ? Number(stat.frameHeight) : null;
      stats.fps = stat.framesPerSecond !== undefined ? Number(stat.framesPerSecond) : null;
      stats.limitation =
        typeof stat.qualityLimitationReason === 'string' ? stat.qualityLimitationReason : null;
      stats.framesDropped = stat.framesDropped !== undefined ? Number(stat.framesDropped) : null;

      if (typeof stat.codecId === 'string') {
        stats.codec = codecs.get(stat.codecId)?.mimeType?.replace('video/', '') ?? null;
      }

      const bytes = Number(stat.bytesSent ?? 0);
      const timestamp = Number(entry.timestamp);
      const anterior = this.previousVideo;
      if (anterior && timestamp > anterior.timestamp) {
        const deltaBits = (bytes - anterior.bytes) * 8;
        const deltaSegundos = (timestamp - anterior.timestamp) / 1000;
        if (deltaSegundos > 0) stats.bitrateKbps = deltaBits / deltaSegundos / 1000;
      }
      this.previousVideo = { bytes, timestamp };
    });

    return stats;
  }

  reset(peerId?: string): void {
    if (peerId) this.previous.delete(peerId);
    else this.previous.clear();
  }
}

/**
 * Classifica a conexao a partir de RTT, perda e jitter medidos.
 * Sem dados suficientes devolve 'desconhecida' em vez de chutar.
 */
export function classifyQuality(stats: VoiceStats): VoiceStats['quality'] {
  const { rttMs, packetLossPercent, jitterMs } = stats;
  if (rttMs === null && packetLossPercent === null) return 'desconhecida';

  const ruim =
    (rttMs !== null && rttMs > 300) ||
    (packetLossPercent !== null && packetLossPercent > 5) ||
    (jitterMs !== null && jitterMs > 50);
  if (ruim) return 'ruim';

  const media =
    (rttMs !== null && rttMs > 150) ||
    (packetLossPercent !== null && packetLossPercent > 2) ||
    (jitterMs !== null && jitterMs > 30);
  return media ? 'media' : 'excelente';
}

export interface ScreenStats {
  /** Resolucao efetivamente codificada, que pode ser menor que a capturada. */
  width: number | null;
  height: number | null;
  fps: number | null;
  bitrateKbps: number | null;
  codec: string | null;
  /**
   * Motivo pelo qual o encoder esta reduzindo qualidade: 'cpu', 'bandwidth',
   * 'none' ou 'other'. Vem direto do WebRTC.
   */
  limitation: string | null;
  /** Quadros descartados por nao dar conta de codificar. */
  framesDropped: number | null;
}

export const EMPTY_SCREEN_STATS: ScreenStats = {
  width: null,
  height: null,
  fps: null,
  bitrateKbps: null,
  codec: null,
  limitation: null,
  framesDropped: null,
};
