/**
 * Capacidades reais do navegador. Nada aqui e assumido: `getSupportedConstraints`
 * diz o que o browser de fato aceita, e pedir uma constraint nao suportada pode
 * fazer o getUserMedia inteiro falhar em alguns navegadores.
 */
export interface AudioCapabilities {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  channelCount: boolean;
  sampleRate: boolean;
  sampleSize: boolean;
  latency: boolean;
  deviceId: boolean;
}

export function detectAudioCapabilities(): AudioCapabilities {
  const supported = navigator.mediaDevices?.getSupportedConstraints?.() ?? {};
  return {
    echoCancellation: supported.echoCancellation === true,
    noiseSuppression: supported.noiseSuppression === true,
    autoGainControl: supported.autoGainControl === true,
    channelCount: supported.channelCount === true,
    sampleRate: supported.sampleRate === true,
    sampleSize: supported.sampleSize === true,
    latency: supported.latency === true,
    deviceId: supported.deviceId === true,
  };
}

export interface AudioPreferences {
  deviceId: string | null;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

export const DEFAULT_AUDIO_PREFERENCES: AudioPreferences = {
  deviceId: null,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/**
 * Monta as constraints incluindo apenas o que o navegador declarou suportar.
 * Opus opera nativamente a 48 kHz mono - pedir isso evita reamostragem extra
 * no caminho ate o encoder.
 */
export function buildAudioConstraints(
  prefs: AudioPreferences,
  caps: AudioCapabilities,
): MediaStreamConstraints {
  const audio: MediaTrackConstraints = {};

  if (caps.deviceId && prefs.deviceId) audio.deviceId = { exact: prefs.deviceId };
  if (caps.echoCancellation) audio.echoCancellation = prefs.echoCancellation;
  if (caps.noiseSuppression) audio.noiseSuppression = prefs.noiseSuppression;
  if (caps.autoGainControl) audio.autoGainControl = prefs.autoGainControl;
  if (caps.channelCount) audio.channelCount = 1;
  if (caps.sampleRate) audio.sampleRate = 48000;
  if (caps.sampleSize) audio.sampleSize = 16;

  return { audio: Object.keys(audio).length > 0 ? audio : true, video: false };
}

/** O que o navegador realmente entregou, que pode diferir do pedido. */
export function describeTrackSettings(track: MediaStreamTrack): Record<string, unknown> {
  const settings = track.getSettings();
  return {
    deviceId: settings.deviceId,
    sampleRate: settings.sampleRate,
    channelCount: settings.channelCount,
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl,
    latency: settings.latency,
  };
}
