export type EqPreset = 'default' | 'voice' | 'warm' | 'bright' | 'radio' | 'custom';

export interface EqBands {
  /** Ganho em dB por banda. */
  bass: number;
  mid: number;
  treble: number;
}

/**
 * Presets pensados para voz, nao para musica. Ganhos moderados de proposito:
 * equalizacao agressiva antes do Opus desperdicia bitrate reforcando faixas
 * que o codec depois trata como menos relevantes.
 */
export const EQ_PRESETS: Record<Exclude<EqPreset, 'custom'>, EqBands> = {
  default: { bass: 0, mid: 0, treble: 0 },
  // Realca a faixa de inteligibilidade (1-4 kHz) e alivia o grave.
  voice: { bass: -2, mid: 3, treble: 1 },
  warm: { bass: 3, mid: 0, treble: -2 },
  bright: { bass: -1, mid: 1, treble: 4 },
  // Banda estreita, som de radio: corta extremos.
  radio: { bass: -6, mid: 5, treble: -4 },
};

/**
 * Equalizador de tres bandas em cadeia: lowshelf, peaking e highshelf.
 */
export class Equalizer {
  private readonly bassNode: BiquadFilterNode;
  private readonly midNode: BiquadFilterNode;
  private readonly trebleNode: BiquadFilterNode;
  private preset: EqPreset = 'default';

  constructor(context: AudioContext) {
    this.bassNode = context.createBiquadFilter();
    this.bassNode.type = 'lowshelf';
    this.bassNode.frequency.value = 200;

    this.midNode = context.createBiquadFilter();
    this.midNode.type = 'peaking';
    this.midNode.frequency.value = 2000;
    this.midNode.Q.value = 0.9;

    this.trebleNode = context.createBiquadFilter();
    this.trebleNode.type = 'highshelf';
    this.trebleNode.frequency.value = 6000;

    this.bassNode.connect(this.midNode).connect(this.trebleNode);
  }

  get input(): AudioNode {
    return this.bassNode;
  }

  get output(): AudioNode {
    return this.trebleNode;
  }

  applyPreset(preset: EqPreset): void {
    this.preset = preset;
    if (preset === 'custom') return;
    this.setBands(EQ_PRESETS[preset]);
  }

  setBands(bands: EqBands): void {
    this.bassNode.gain.value = bands.bass;
    this.midNode.gain.value = bands.mid;
    this.trebleNode.gain.value = bands.treble;
  }

  getBands(): EqBands {
    return {
      bass: this.bassNode.gain.value,
      mid: this.midNode.gain.value,
      treble: this.trebleNode.gain.value,
    };
  }

  getPreset(): EqPreset {
    return this.preset;
  }
}
