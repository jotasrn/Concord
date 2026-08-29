/**
 * `latency` faz parte da Media Capture and Streams spec e e reportado pelos
 * navegadores, mas ainda nao existe nos tipos do TypeScript. Declarado aqui
 * para nao precisarmos abrir mao da metrica nem usar `any`.
 */
interface MediaTrackSupportedConstraints {
  latency?: boolean;
}

interface MediaTrackSettings {
  latency?: number;
}
