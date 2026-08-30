/**
 * Perfis de qualidade para compartilhamento de tela.
 *
 * A escolha central e o que sacrificar quando a banda aperta. Video de jogo e
 * video de codigo tem exigencias opostas: um precisa de quadros, o outro de
 * nitidez. Um unico preset "alta qualidade" serve mal aos dois.
 */
export type PresetId = 'gaming' | 'cinema' | 'leitura' | 'economia' | 'custom';

export interface ScreenQuality {
  /** Altura maxima da captura em pixels. */
  height: number;
  frameRate: number;
  /** Teto de bitrate em bits por segundo. */
  maxBitrate: number;
  /**
   * Dica ao codec sobre o tipo de conteudo.
   * - 'motion': prioriza fluidez, aceita borrar em cena rapida (jogos, video)
   * - 'detail': prioriza nitidez, aceita engasgar (codigo, planilha, leitura)
   * - 'text': agressivamente otimizado para texto
   */
  contentHint: 'motion' | 'detail' | 'text';
  /**
   * O que o WebRTC degrada primeiro sob pressao de rede ou CPU. Espelha o
   * contentHint, mas atua no encoder em vez do capturador.
   */
  degradation: RTCDegradationPreference;
  /** Captura o audio do sistema junto com a imagem. */
  systemAudio: boolean;
}

export interface Preset {
  id: PresetId;
  label: string;
  description: string;
  quality: ScreenQuality;
}

export const PRESETS: Preset[] = [
  {
    id: 'gaming',
    label: 'Jogo',
    description: '1080p 60fps, prioriza fluidez',
    quality: {
      height: 1080,
      frameRate: 60,
      maxBitrate: 8_000_000,
      contentHint: 'motion',
      degradation: 'maintain-framerate',
      systemAudio: true,
    },
  },
  {
    id: 'cinema',
    label: 'Video',
    description: '1080p 30fps, equilibrado',
    quality: {
      height: 1080,
      frameRate: 30,
      maxBitrate: 5_000_000,
      contentHint: 'motion',
      degradation: 'balanced',
      systemAudio: true,
    },
  },
  {
    id: 'leitura',
    label: 'Codigo',
    description: '1440p 15fps, prioriza nitidez',
    quality: {
      height: 1440,
      frameRate: 15,
      maxBitrate: 4_000_000,
      contentHint: 'text',
      // Texto ilegivel nao serve para nada: melhor perder quadros que resolucao.
      degradation: 'maintain-resolution',
      systemAudio: false,
    },
  },
  {
    id: 'economia',
    label: 'Economia',
    description: '720p 15fps, pouca banda',
    quality: {
      height: 720,
      frameRate: 15,
      maxBitrate: 1_200_000,
      contentHint: 'detail',
      degradation: 'balanced',
      systemAudio: false,
    },
  },
];

export const DEFAULT_PRESET: PresetId = 'gaming';

export function presetById(id: PresetId): Preset | null {
  return PRESETS.find((p) => p.id === id) ?? null;
}

export function qualityFor(id: PresetId, custom: ScreenQuality): ScreenQuality {
  return id === 'custom' ? custom : (presetById(id)?.quality ?? custom);
}

export const BITRATE_STEPS = [
  { label: '500 kbps', value: 500_000 },
  { label: '1 Mbps', value: 1_000_000 },
  { label: '2,5 Mbps', value: 2_500_000 },
  { label: '5 Mbps', value: 5_000_000 },
  { label: '8 Mbps', value: 8_000_000 },
  { label: '15 Mbps', value: 15_000_000 },
];

export const HEIGHT_STEPS = [720, 1080, 1440, 2160];
export const FPS_STEPS = [5, 15, 30, 60];
