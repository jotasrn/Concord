import { AudioLevels } from './AudioMeter';

export type VoiceState = 'SPEAKING' | 'SILENCE';

export interface VadOptions {
  /**
   * Quantos dB acima do piso de ruido o sinal precisa estar para contar como
   * voz. Threshold relativo ao piso, e nao absoluto: um valor fixo dispararia
   * com ventilador ligado e falharia com microfone de ganho baixo.
   */
  thresholdOverNoiseDb: number;
  /** Tempo acima do limiar antes de declarar SPEAKING. Corta cliques. */
  attackMs: number;
  /**
   * Tempo abaixo do limiar antes de voltar a SILENCE. Evita cortar a voz nas
   * pausas naturais entre palavras.
   */
  releaseMs: number;
  /** Piso absoluto: abaixo disso e silencio, independente do piso de ruido. */
  absoluteFloorDb: number;
}

export const DEFAULT_VAD_OPTIONS: VadOptions = {
  thresholdOverNoiseDb: 12,
  attackMs: 40,
  releaseMs: 320,
  absoluteFloorDb: -55,
};

/**
 * Detector de voz com histerese e calibracao de piso de ruido.
 *
 * Um unico threshold fixo nao funciona: o mesmo valor que ignora um ventilador
 * corta uma pessoa falando baixo. Aqui o limiar acompanha o piso medido, e a
 * histerese (attack/release) evita o estado piscar durante a fala.
 */
export class VoiceActivityDetector {
  private state: VoiceState = 'SILENCE';
  private aboveSince: number | null = null;
  private belowSince: number | null = null;
  private calibrating = false;
  private calibrationUntil = 0;
  private calibrationSum = 0;
  private calibrationCount = 0;
  private calibratedFloorDb: number | null = null;

  constructor(private options: VadOptions = DEFAULT_VAD_OPTIONS) {}

  setOptions(options: Partial<VadOptions>): void {
    this.options = { ...this.options, ...options };
  }

  getOptions(): VadOptions {
    return { ...this.options };
  }

  /** Mede o ambiente por alguns segundos com o usuario em silencio. */
  startCalibration(durationMs = 3000): void {
    this.calibrating = true;
    this.calibrationUntil = performance.now() + durationMs;
    this.calibrationSum = 0;
    this.calibrationCount = 0;
  }

  get isCalibrating(): boolean {
    return this.calibrating;
  }

  get calibratedNoiseFloorDb(): number | null {
    return this.calibratedFloorDb;
  }

  update(levels: AudioLevels): VoiceState {
    const now = performance.now();

    if (this.calibrating) {
      if (Number.isFinite(levels.rmsDb)) {
        this.calibrationSum += levels.rmsDb;
        this.calibrationCount++;
      }
      if (now >= this.calibrationUntil) {
        this.calibrating = false;
        this.calibratedFloorDb =
          this.calibrationCount > 0 ? this.calibrationSum / this.calibrationCount : null;
      }
      return 'SILENCE';
    }

    const floorDb = this.calibratedFloorDb ?? levels.noiseFloorDb;
    const threshold = Math.max(
      floorDb + this.options.thresholdOverNoiseDb,
      this.options.absoluteFloorDb,
    );
    const isAbove = levels.rmsDb > threshold;

    if (isAbove) {
      this.belowSince = null;
      if (this.aboveSince === null) this.aboveSince = now;
      if (this.state === 'SILENCE' && now - this.aboveSince >= this.options.attackMs) {
        this.state = 'SPEAKING';
      }
    } else {
      this.aboveSince = null;
      if (this.belowSince === null) this.belowSince = now;
      if (this.state === 'SPEAKING' && now - this.belowSince >= this.options.releaseMs) {
        this.state = 'SILENCE';
      }
    }

    return this.state;
  }

  get current(): VoiceState {
    return this.state;
  }

  reset(): void {
    this.state = 'SILENCE';
    this.aboveSince = null;
    this.belowSince = null;
    this.calibratedFloorDb = null;
  }
}
