export interface AudioDevice {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
}

/**
 * O navegador so revela os rotulos dos dispositivos depois que uma permissao de
 * microfone foi concedida. Antes disso `label` vem vazio, e a UI precisa
 * mostrar um nome generico em vez de um item em branco.
 */
export async function listAudioDevices(): Promise<{
  inputs: AudioDevice[];
  outputs: AudioDevice[];
  labelsAvailable: boolean;
}> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const labelsAvailable = devices.some((d) => d.label !== '');

  const map = (d: MediaDeviceInfo, index: number, prefixo: string): AudioDevice => ({
    deviceId: d.deviceId,
    label: d.label || `${prefixo} ${index + 1}`,
    kind: d.kind,
  });

  return {
    inputs: devices.filter((d) => d.kind === 'audioinput').map((d, i) => map(d, i, 'Microfone')),
    outputs: devices.filter((d) => d.kind === 'audiooutput').map((d, i) => map(d, i, 'Saida')),
    labelsAvailable,
  };
}

export async function listVideoDevices(): Promise<AudioDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `Camera ${i + 1}`,
      kind: d.kind,
    }));
}

/** Notifica quando um fone e plugado ou removido durante a chamada. */
export function onDeviceChange(handler: () => void): () => void {
  navigator.mediaDevices.addEventListener('devicechange', handler);
  return () => navigator.mediaDevices.removeEventListener('devicechange', handler);
}
