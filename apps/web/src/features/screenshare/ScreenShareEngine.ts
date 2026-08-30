import { ScreenQuality } from './presets';

/** Prazo para a fonte de captura responder antes de desistir do audio. */
const CAPTURE_TIMEOUT_MS = 10_000;

export interface CaptureSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  thumbnail: string;
  appIcon: string | null;
}

export interface CaptureInfo {
  width: number;
  height: number;
  frameRate: number;
  hasAudio: boolean;
  sourceName: string;
}

/**
 * Captura de tela com controle de qualidade.
 *
 * Separada do transporte de proposito: aqui vive tudo que decide COMO a imagem
 * e capturada e codificada; o PeerToPeerTransport so recebe uma track pronta.
 * Assim trocar de fonte, mudar preset ou pausar nao mexe na negociacao WebRTC.
 */
export class ScreenShareEngine {
  private stream: MediaStream | null = null;
  private source: CaptureSource | null = null;
  private quality: ScreenQuality | null = null;
  private paused = false;

  /**
   * Canvas usado para congelar a imagem ao pausar. Parar a track encerraria a
   * transmissao e forcaria renegociacao ao retomar; substituir por um quadro
   * estatico mantem a sessao viva.
   */
  private frozenTrack: MediaStreamTrack | null = null;

  async listSources(): Promise<CaptureSource[]> {
    return window.concord.screen.sources();
  }

  /**
   * getUserMedia com prazo.
   *
   * A captura de audio do sistema pode nao responder nunca, dependendo do
   * driver de som - observado ao pedir audio isolado nesta plataforma. Sem
   * prazo, o botao de compartilhar ficaria girando para sempre em vez de cair
   * no caminho alternativo sem audio.
   */
  private async capture(
    video: Record<string, unknown>,
    audio: Record<string, unknown> | false,
  ): Promise<MediaStream> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        navigator.mediaDevices.getUserMedia({ video, audio } as unknown as MediaStreamConstraints),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('a fonte de captura nao respondeu')),
            CAPTURE_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Captura uma fonte especifica.
   *
   * Usa as constraints `chromeMediaSource` do Electron em vez de
   * getDisplayMedia porque assim o app escolhe a fonte pela propria interface,
   * sem depender do seletor do sistema.
   */
  async start(source: CaptureSource, quality: ScreenQuality): Promise<MediaStreamTrack> {
    await this.stop();

    const video: Record<string, unknown> = {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: source.id,
        maxFrameRate: quality.frameRate,
        maxHeight: quality.height,
      },
    };

    // Audio do sistema so funciona capturando uma tela inteira; para uma
    // janela isolada o Chromium nao expoe o loopback.
    const wantsAudio = quality.systemAudio && source.kind === 'screen';
    const audio = wantsAudio
      ? { mandatory: { chromeMediaSource: 'desktop' } }
      : false;

    let stream: MediaStream;
    try {
      stream = await this.capture(video, audio);
    } catch (error) {
      // O audio do sistema e a parte fragil: dependendo do driver ele falha
      // ou simplesmente nunca responde. Perder o som e aceitavel; perder o
      // compartilhamento inteiro por causa dele, nao.
      if (!wantsAudio) throw error;
      stream = await this.capture(video, false);
    }

    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('A fonte selecionada nao forneceu imagem');
    }

    // contentHint muda como o codec trata o quadro. E a alavanca mais barata
    // de qualidade que existe aqui, e vem antes de qualquer ajuste de bitrate.
    track.contentHint = quality.contentHint;

    this.stream = stream;
    this.source = source;
    this.quality = quality;
    this.paused = false;

    return track;
  }

  /** Track de audio do sistema, quando a captura incluiu som. */
  getAudioTrack(): MediaStreamTrack | null {
    return this.stream?.getAudioTracks()[0] ?? null;
  }

  getVideoTrack(): MediaStreamTrack | null {
    return this.paused ? this.frozenTrack : (this.stream?.getVideoTracks()[0] ?? null);
  }

  getSource(): CaptureSource | null {
    return this.source;
  }

  getQuality(): ScreenQuality | null {
    return this.quality;
  }

  isPaused(): boolean {
    return this.paused;
  }

  isActive(): boolean {
    return this.stream !== null;
  }

  /** Resolucao e taxa que o sistema realmente entregou, nao a que foi pedida. */
  getCaptureInfo(): CaptureInfo | null {
    const track = this.stream?.getVideoTracks()[0];
    if (!track || !this.source) return null;

    const settings = track.getSettings();
    return {
      width: settings.width ?? 0,
      height: settings.height ?? 0,
      frameRate: Math.round(settings.frameRate ?? 0),
      hasAudio: (this.stream?.getAudioTracks().length ?? 0) > 0,
      sourceName: this.source.name,
    };
  }

  /**
   * Ajusta a captura sem reabrir a fonte. `applyConstraints` renegocia com o
   * capturador do sistema, entao o peer nao ve interrupcao.
   */
  async applyQuality(quality: ScreenQuality): Promise<void> {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return;

    this.quality = quality;
    track.contentHint = quality.contentHint;

    try {
      await track.applyConstraints({
        frameRate: { max: quality.frameRate },
        height: { max: quality.height },
      });
    } catch {
      // Nem toda fonte aceita reconfiguracao; o bitrate no encoder ainda
      // limita o resultado.
    }
  }

  /**
   * Congela a imagem sem derrubar a track: gera um quadro estatico a partir do
   * ultimo frame. Retomar so troca a track de volta, sem renegociar.
   */
  async pause(): Promise<MediaStreamTrack | null> {
    const live = this.stream?.getVideoTracks()[0];
    if (!live || this.paused) return null;

    const canvas = document.createElement('canvas');
    const settings = live.getSettings();
    canvas.width = settings.width ?? 1280;
    canvas.height = settings.height ?? 720;

    const context = canvas.getContext('2d');
    if (context) {
      const video = document.createElement('video');
      video.srcObject = new MediaStream([live]);
      video.muted = true;
      await video.play().catch(() => undefined);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      video.srcObject = null;

      // Sobrepoe um aviso, para quem assiste entender que a imagem parou.
      context.fillStyle = 'rgba(0,0,0,0.55)';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#C4A6FF';
      context.font = `${Math.round(canvas.height / 18)}px sans-serif`;
      context.textAlign = 'center';
      context.fillText('Compartilhamento pausado', canvas.width / 2, canvas.height / 2);
    }

    // 1 fps: e um quadro parado, nao ha motivo para gastar banda.
    this.frozenTrack = canvas.captureStream(1).getVideoTracks()[0] ?? null;
    this.paused = true;
    return this.frozenTrack;
  }

  resume(): MediaStreamTrack | null {
    if (!this.paused) return null;
    this.frozenTrack?.stop();
    this.frozenTrack = null;
    this.paused = false;
    return this.stream?.getVideoTracks()[0] ?? null;
  }

  /** Avisa quando o usuario encerra a captura pelo proprio sistema. */
  onEnded(handler: () => void): () => void {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return () => undefined;
    track.addEventListener('ended', handler);
    return () => track.removeEventListener('ended', handler);
  }

  async stop(): Promise<void> {
    this.frozenTrack?.stop();
    this.frozenTrack = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.source = null;
    this.quality = null;
    this.paused = false;
  }
}
