/**
 * Efeitos sonoros sintetizados na hora com Web Audio.
 *
 * Nada de arquivos: sons curtos gerados por osciladores nao pesam no
 * instalador, nao dependem de assets de terceiros e podem ser afinados por
 * numero. Todos usam envelope com ataque e queda suaves - corte seco produz
 * clique audivel.
 */
export type SoundName =
  | 'join'
  | 'leave'
  | 'peerJoin'
  | 'peerLeave'
  | 'message'
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'error'
  | 'success'
  | 'screenStart'
  | 'screenStop'
  | 'messageSent';

interface Tone {
  /** Frequencias em Hz, tocadas em sequencia. */
  notes: number[];
  /** Duracao de cada nota em segundos. */
  noteDuration: number;
  type: OscillatorType;
  gain: number;
  /** Sobreposicao entre notas, para soar ligado em vez de picotado. */
  overlap?: number;
}

/**
 * Desenho dos sons: subir de tom comunica entrada/sucesso, descer comunica
 * saida/erro. Terceiras e quintas soam agradaveis e nao cansam em repeticao.
 */
const TONES: Record<SoundName, Tone> = {
  // Voce entrou: terca maior ascendente, confiante.
  join: { notes: [523.25, 659.25, 783.99], noteDuration: 0.075, type: 'sine', gain: 0.18 },
  // Voce saiu: mesma figura invertida.
  leave: { notes: [783.99, 659.25, 523.25], noteDuration: 0.075, type: 'sine', gain: 0.16 },
  // Alguem entrou: dois tons curtos e discretos, para nao competir com a fala.
  peerJoin: { notes: [587.33, 880.0], noteDuration: 0.06, type: 'sine', gain: 0.12 },
  peerLeave: { notes: [880.0, 587.33], noteDuration: 0.06, type: 'sine', gain: 0.11 },
  // Mensagem: nota unica curta, quase um toque.
  message: { notes: [1046.5], noteDuration: 0.055, type: 'sine', gain: 0.1 },
  // Mute/unmute: par grave/agudo, reconhecivel sem olhar a tela.
  mute: { notes: [440.0, 329.63], noteDuration: 0.05, type: 'triangle', gain: 0.14 },
  unmute: { notes: [329.63, 440.0], noteDuration: 0.05, type: 'triangle', gain: 0.14 },
  deafen: { notes: [392.0, 261.63], noteDuration: 0.07, type: 'triangle', gain: 0.14 },
  // Erro: segunda menor descendente, dissonante de proposito.
  error: { notes: [415.3, 311.13], noteDuration: 0.11, type: 'sawtooth', gain: 0.1 },
  success: { notes: [659.25, 987.77], noteDuration: 0.07, type: 'sine', gain: 0.14 },
  // Transmissao começando: subida decidida, distinta do som de entrar na call.
  screenStart: {
    notes: [493.88, 622.25, 830.61],
    noteDuration: 0.06,
    type: 'triangle',
    gain: 0.15,
  },
  screenStop: { notes: [830.61, 622.25, 493.88], noteDuration: 0.06, type: 'triangle', gain: 0.13 },
  // Mensagem enviada: mais discreto que a recebida, para nao cansar quem digita muito.
  messageSent: { notes: [880.0], noteDuration: 0.04, type: 'sine', gain: 0.07 },
};

class SoundEffectsPlayer {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = true;
  private volume = 0.7;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.context.destination);
    }
    // Navegadores suspendem o contexto ate a primeira interacao do usuario.
    if (this.context.state === 'suspended') void this.context.resume();
    return this.context;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.master) this.master.gain.value = this.volume;
  }

  getVolume(): number {
    return this.volume;
  }

  play(name: SoundName): void {
    if (!this.enabled) return;

    const context = this.ensureContext();
    if (!context || !this.master) return;

    const tone = TONES[name];
    const overlap = tone.overlap ?? 0.02;
    let start = context.currentTime;

    for (const frequency of tone.notes) {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();

      oscillator.type = tone.type;
      oscillator.frequency.setValueAtTime(frequency, start);

      // Ataque de 8ms e queda exponencial: sem isso o corte estala.
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(tone.gain, start + 0.008);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + tone.noteDuration);

      oscillator.connect(envelope).connect(this.master);
      oscillator.start(start);
      oscillator.stop(start + tone.noteDuration + 0.02);

      start += tone.noteDuration - overlap;
    }
  }

  /** Prepara o contexto no primeiro clique, para o primeiro som nao falhar. */
  unlock(): void {
    this.ensureContext();
  }
}

export const sounds = new SoundEffectsPlayer();
