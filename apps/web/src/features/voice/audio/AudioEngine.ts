import { AudioLevels, AudioMeter } from './AudioMeter';
import { EqPreset, Equalizer } from './Equalizer';
import { NoiseSuppression, createNoiseSuppression } from './NoiseSuppression';
import { DEFAULT_VAD_OPTIONS, VadOptions, VoiceActivityDetector, VoiceState } from './VoiceActivityDetector';
import {
  AudioCapabilities,
  AudioPreferences,
  DEFAULT_AUDIO_PREFERENCES,
  buildAudioConstraints,
  describeTrackSettings,
  detectAudioCapabilities,
} from './constraints';

export type TransmitMode = 'voice-activity' | 'push-to-talk' | 'always-on';

/** ~30 Hz: resolucao suficiente para o VAD reagir sem pesar na CPU. */
const LOOP_INTERVAL_MS = 33;

export interface AudioEngineState {
  levels: AudioLevels;
  voiceState: VoiceState;
  transmitting: boolean;
  calibrating: boolean;
}

export interface AudioEngineOptions {
  preferences?: Partial<AudioPreferences>;
  transmitMode?: TransmitMode;
  eqPreset?: EqPreset;
  noiseSuppressionKind?: string;
  vad?: Partial<VadOptions>;
  /**
   * Desliga o compressor. Ele adiciona lookahead no Chromium, e em modo de
   * latencia minima esses milissegundos importam mais que a uniformidade de
   * volume.
   */
  useCompressor?: boolean;
}

/**
 * Pipeline de captura:
 *
 *   getUserMedia (AEC + NS + AGC nativos)
 *        -> HighPass 85 Hz      remove rumble, DC e ruido de mesa
 *        -> Equalizer           3 bandas com presets de voz
 *        -> Compressor          uniformiza distancia ate o microfone
 *        -> Gain (transmissao)  porta de PTT / VAD, sem cortar a analise
 *        -> Destination         track processada que vai para o WebRTC/Opus
 *
 * O medidor e o VAD saem de um ramo paralelo ligado ANTES do gate: assim o
 * indicador de nivel continua funcionando enquanto o usuario esta mutado, que
 * e o que a tela de configuracoes precisa.
 */
export class AudioEngine {
  private context: AudioContext | null = null;
  private rawStream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private highPass: BiquadFilterNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private transmitGain: GainNode | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;

  private equalizer: Equalizer | null = null;
  private meter: AudioMeter | null = null;
  private noiseSuppression: NoiseSuppression | null = null;
  private readonly vad = new VoiceActivityDetector();

  private capabilities: AudioCapabilities = detectAudioCapabilities();
  private preferences: AudioPreferences = { ...DEFAULT_AUDIO_PREFERENCES };
  private transmitMode: TransmitMode = 'voice-activity';
  private eqPreset: EqPreset = 'voice';
  private noiseSuppressionKind = 'native';
  private useCompressor = true;

  private pttActive = false;
  private loopTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(state: AudioEngineState) => void>();
  private lastState: AudioEngineState | null = null;

  constructor(options: AudioEngineOptions = {}) {
    if (options.preferences) Object.assign(this.preferences, options.preferences);
    if (options.transmitMode) this.transmitMode = options.transmitMode;
    if (options.eqPreset) this.eqPreset = options.eqPreset;
    if (options.noiseSuppressionKind) this.noiseSuppressionKind = options.noiseSuppressionKind;
    if (options.useCompressor !== undefined) this.useCompressor = options.useCompressor;
    this.vad.setOptions({ ...DEFAULT_VAD_OPTIONS, ...options.vad });
  }

  getCapabilities(): AudioCapabilities {
    return { ...this.capabilities };
  }

  getPreferences(): AudioPreferences {
    return { ...this.preferences };
  }

  isRunning(): boolean {
    return this.context !== null;
  }

  /** Latencia introduzida pelo proprio grafo de audio, em ms. */
  getGraphLatencyMs(): number | null {
    if (!this.context) return null;
    const base = this.context.baseLatency * 1000;
    const saida = (this.context.outputLatency ?? 0) * 1000;
    // O compressor do Chromium adianta o sinal para reagir a transientes.
    const compressor = this.useCompressor ? 6 : 0;
    return base + saida + compressor;
  }

  /** Constraints efetivamente entregues pelo navegador, para diagnostico. */
  getActualSettings(): Record<string, unknown> | null {
    const track = this.rawStream?.getAudioTracks()[0];
    return track ? describeTrackSettings(track) : null;
  }

  async start(): Promise<void> {
    if (this.context) return;

    this.capabilities = detectAudioCapabilities();
    const constraints = buildAudioConstraints(this.preferences, this.capabilities);
    this.rawStream = await navigator.mediaDevices.getUserMedia(constraints);

    // 48 kHz e a taxa nativa do Opus: evita uma reamostragem no caminho.
    const context = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    this.context = context;

    this.noiseSuppression = createNoiseSuppression(this.noiseSuppressionKind);
    await this.noiseSuppression.initialize(context);

    this.source = context.createMediaStreamSource(this.rawStream);

    this.highPass = context.createBiquadFilter();
    this.highPass.type = 'highpass';
    this.highPass.frequency.value = 85;
    this.highPass.Q.value = 0.707;

    this.equalizer = new Equalizer(context);
    this.equalizer.applyPreset(this.eqPreset);

    this.compressor = context.createDynamicsCompressor();
    // Ajuste conservador: segura picos sem achatar a dinamica da fala.
    this.compressor.threshold.value = -24;
    this.compressor.knee.value = 12;
    this.compressor.ratio.value = 3;
    this.compressor.attack.value = 0.005;
    this.compressor.release.value = 0.15;

    this.transmitGain = context.createGain();
    this.transmitGain.gain.value = 0;

    this.destination = context.createMediaStreamDestination();
    this.meter = new AudioMeter(context);

    // Cadeia principal.
    let head: AudioNode = this.source;
    const nsNode = this.noiseSuppression.getNode();
    if (nsNode) head = head.connect(nsNode);

    head = head.connect(this.highPass);
    head.connect(this.equalizer.input);

    // O compressor entra na cadeia so quando pedido: ele custa alguns
    // milissegundos de lookahead.
    const saida: AudioNode = this.useCompressor
      ? (this.equalizer.output.connect(this.compressor), this.compressor)
      : this.equalizer.output;

    // Ramo de analise: antes do gate, para medir mesmo mutado.
    saida.connect(this.meter.node);

    saida.connect(this.transmitGain);
    this.transmitGain.connect(this.destination);

    if (context.state === 'suspended') await context.resume();

    // Intervalo em vez de requestAnimationFrame: o Chromium congela o rAF
    // quando a janela esta minimizada ou oculta, o que travaria o gate de
    // transmissao no meio de uma chamada. 30 Hz e de sobra para medidor e VAD,
    // e gasta menos CPU que os 60 Hz do rAF.
    this.loopTimer = setInterval(this.loop, LOOP_INTERVAL_MS);
    this.loop();
  }

  /** Track ja processada, pronta para entrar na RTCPeerConnection. */
  getProcessedTrack(): MediaStreamTrack | null {
    return this.destination?.stream.getAudioTracks()[0] ?? null;
  }

  getProcessedStream(): MediaStream | null {
    return this.destination?.stream ?? null;
  }

  private loop = (): void => {
    if (!this.meter) return;

    const levels = this.meter.read();
    const voiceState = this.vad.update(levels);
    const transmitting = this.shouldTransmit(voiceState);

    if (this.transmitGain && this.context) {
      // Rampa curta em vez de corte seco: evita o "clique" audivel do gate.
      const target = transmitting ? 1 : 0;
      const now = this.context.currentTime;
      this.transmitGain.gain.setTargetAtTime(target, now, transmitting ? 0.01 : 0.05);
    }

    const state: AudioEngineState = {
      levels,
      voiceState,
      transmitting,
      calibrating: this.vad.isCalibrating,
    };
    this.lastState = state;
    for (const listener of this.listeners) listener(state);

  };

  private shouldTransmit(voiceState: VoiceState): boolean {
    switch (this.transmitMode) {
      case 'always-on':
        return true;
      case 'push-to-talk':
        return this.pttActive;
      case 'voice-activity':
        return voiceState === 'SPEAKING';
    }
  }

  // ---------- controles ----------

  setTransmitMode(mode: TransmitMode): void {
    this.transmitMode = mode;
  }

  getTransmitMode(): TransmitMode {
    return this.transmitMode;
  }

  setPushToTalk(active: boolean): void {
    this.pttActive = active;
  }

  setEqPreset(preset: EqPreset): void {
    this.eqPreset = preset;
    this.equalizer?.applyPreset(preset);
  }

  getEqPreset(): EqPreset {
    return this.eqPreset;
  }

  setVadOptions(options: Partial<VadOptions>): void {
    this.vad.setOptions(options);
  }

  getVadOptions(): VadOptions {
    return this.vad.getOptions();
  }

  /**
   * Sensibilidade 0..100 mapeada para dB acima do piso de ruido. Mais
   * sensibilidade = menor limiar, entao a escala e invertida.
   */
  setInputSensitivity(percent: number): void {
    const clamped = Math.min(100, Math.max(0, percent));
    this.vad.setOptions({ thresholdOverNoiseDb: 30 - (clamped / 100) * 27 });
  }

  getInputSensitivity(): number {
    return ((30 - this.vad.getOptions().thresholdOverNoiseDb) / 27) * 100;
  }

  calibrateNoiseFloor(durationMs = 3000): void {
    this.meter?.resetNoiseFloor();
    this.vad.startCalibration(durationMs);
  }

  subscribe(listener: (state: AudioEngineState) => void): () => void {
    this.listeners.add(listener);
    if (this.lastState) listener(this.lastState);
    return () => this.listeners.delete(listener);
  }

  /**
   * Troca de microfone sem derrubar a chamada: o grafo e reconstruido, mas a
   * track de destino (a que esta na PeerConnection) e a mesma.
   */
  async switchDevice(deviceId: string | null): Promise<void> {
    this.preferences.deviceId = deviceId;
    if (!this.context || !this.source) return;

    const constraints = buildAudioConstraints(this.preferences, this.capabilities);
    const novoStream = await navigator.mediaDevices.getUserMedia(constraints);

    this.source.disconnect();
    this.rawStream?.getTracks().forEach((t) => t.stop());
    this.rawStream = novoStream;

    this.source = this.context.createMediaStreamSource(novoStream);
    const nsNode = this.noiseSuppression?.getNode() ?? null;
    if (nsNode) this.source.connect(nsNode);
    else if (this.highPass) this.source.connect(this.highPass);

    this.meter?.resetNoiseFloor();
    this.vad.reset();
  }

  async applyPreferences(prefs: Partial<AudioPreferences>): Promise<void> {
    Object.assign(this.preferences, prefs);
    if (!this.isRunning()) return;
    // AEC/NS/AGC sao constraints da track: exigem recapturar o dispositivo.
    await this.switchDevice(this.preferences.deviceId);
  }

  async stop(): Promise<void> {
    if (this.loopTimer !== null) clearInterval(this.loopTimer);
    this.loopTimer = null;

    this.noiseSuppression?.destroy();
    this.rawStream?.getTracks().forEach((t) => t.stop());
    await this.context?.close();

    this.context = null;
    this.rawStream = null;
    this.source = null;
    this.highPass = null;
    this.compressor = null;
    this.transmitGain = null;
    this.destination = null;
    this.equalizer = null;
    this.meter = null;
    this.noiseSuppression = null;
    this.lastState = null;
    this.vad.reset();
  }
}
