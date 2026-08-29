export interface AudioLevels {
  /** Energia media do bloco, 0..1. E o que corresponde ao volume percebido. */
  rms: number;
  /** Maior amostra absoluta do bloco, 0..1. Detecta transientes. */
  peak: number;
  /** RMS em dBFS. -Infinity em silencio absoluto. */
  rmsDb: number;
  peakDb: number;
  /** Piso de ruido estimado em dBFS. */
  noiseFloorDb: number;
  /** Amostras encostando no limite - indica distorcao. */
  clipping: boolean;
}

export function toDb(amplitude: number): number {
  return amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity;
}

const CLIPPING_THRESHOLD = 0.99;

/**
 * Medidor de entrada. Le o dominio do tempo direto do AnalyserNode - o
 * `getFloatFrequencyData` serviria para espectro, mas RMS e pico precisam da
 * forma de onda.
 */
export class AudioMeter {
  private readonly analyser: AnalyserNode;
  /**
   * Alocado sobre um ArrayBuffer explicito: `new Float32Array(n)` produz
   * Float32Array<ArrayBufferLike>, que inclui SharedArrayBuffer e nao satisfaz
   * a assinatura de getFloatTimeDomainData.
   */
  private readonly buffer: Float32Array<ArrayBuffer>;

  /**
   * Piso de ruido acompanhado por media movel assimetrica: sobe devagar e
   * desce rapido, para que o piso siga o silencio e nao a voz.
   */
  private noiseFloor = 0.0005;
  private lastClipping = 0;

  constructor(context: AudioContext) {
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.2;
    this.buffer = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
  }

  get node(): AnalyserNode {
    return this.analyser;
  }

  read(): AudioLevels {
    this.analyser.getFloatTimeDomainData(this.buffer);

    let sumSquares = 0;
    let peak = 0;
    let clippedSamples = 0;

    for (let i = 0; i < this.buffer.length; i++) {
      const sample = this.buffer[i];
      const abs = Math.abs(sample);
      sumSquares += sample * sample;
      if (abs > peak) peak = abs;
      if (abs >= CLIPPING_THRESHOLD) clippedSamples++;
    }

    const rms = Math.sqrt(sumSquares / this.buffer.length);

    // Atualiza o piso so quando o bloco parece silencio, senao a voz
    // contaminaria a estimativa e o VAD pararia de disparar.
    if (rms < this.noiseFloor * 3) {
      this.noiseFloor = this.noiseFloor * 0.95 + rms * 0.05;
    } else {
      this.noiseFloor = this.noiseFloor * 0.9995 + rms * 0.0005;
    }
    this.noiseFloor = Math.max(this.noiseFloor, 1e-6);

    const now = performance.now();
    if (clippedSamples > 0) this.lastClipping = now;

    return {
      rms,
      peak,
      rmsDb: toDb(rms),
      peakDb: toDb(peak),
      noiseFloorDb: toDb(this.noiseFloor),
      // Mantem o aviso visivel por 1s: um clip de 20ms sumiria antes de ser lido.
      clipping: now - this.lastClipping < 1000,
    };
  }

  get noiseFloorAmplitude(): number {
    return this.noiseFloor;
  }

  /** Reinicia a estimativa ao trocar de dispositivo. */
  resetNoiseFloor(): void {
    this.noiseFloor = 0.0005;
  }
}
