/**
 * Abstracao de supressao de ruido.
 *
 * A implementacao nativa delega ao WebRTC do navegador (constraint
 * `noiseSuppression`), que roda no pipeline C++ antes do audio chegar ao JS.
 * Uma futura AINoiseSuppression (RNNoise/DeepFilterNet via WASM em
 * AudioWorklet) implementa a mesma interface e entra sem tocar no AudioEngine.
 */
export interface NoiseSuppression {
  readonly name: string;
  /** Se o processamento acontece fora do grafo Web Audio (nativo do browser). */
  readonly isPassthroughNode: boolean;
  initialize(context: AudioContext): Promise<void>;
  /**
   * No do grafo por onde o audio passa. `null` quando a supressao acontece
   * antes do grafo, como no caso nativo.
   */
  getNode(): AudioNode | null;
  destroy(): void;
}

/**
 * Supressao nativa do navegador. Nao ha no no grafo: o trabalho ja foi feito
 * pelo WebRTC quando o MediaStream chegou.
 */
export class NativeNoiseSuppression implements NoiseSuppression {
  readonly name = 'Nativo (WebRTC)';
  readonly isPassthroughNode = true;

  async initialize(): Promise<void> {
    // Nada a fazer: e controlado pela constraint do getUserMedia.
  }

  getNode(): AudioNode | null {
    return null;
  }

  destroy(): void {
    // Sem recursos proprios.
  }
}

/**
 * Registro de implementacoes disponiveis. Quando a versao com IA existir,
 * basta registra-la aqui - a UI de configuracoes le desta lista.
 */
export const noiseSuppressionRegistry: Record<string, () => NoiseSuppression> = {
  native: () => new NativeNoiseSuppression(),
};

export function createNoiseSuppression(kind: string): NoiseSuppression {
  const factory = noiseSuppressionRegistry[kind] ?? noiseSuppressionRegistry.native;
  return factory();
}
