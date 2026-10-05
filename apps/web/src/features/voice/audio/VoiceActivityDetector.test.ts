import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceActivityDetector } from './VoiceActivityDetector';
import type { AudioLevels } from './AudioMeter';

let agora = 0;
beforeEach(() => {
  agora = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => agora);
});
afterEach(() => vi.restoreAllMocks());

const nivel = (rmsDb: number, noiseFloorDb = -60) =>
  ({ rmsDb, noiseFloorDb }) as unknown as AudioLevels;

/** Alimenta o detector com o mesmo nivel por `ms`, em quadros de 10 ms. */
function por(vad: VoiceActivityDetector, ms: number, n: AudioLevels) {
  let estado = vad.current;
  for (let t = 0; t < ms; t += 10) {
    agora += 10;
    estado = vad.update(n);
  }
  return estado;
}

describe('VoiceActivityDetector', () => {
  it('so declara fala depois do attack (corta cliques)', () => {
    const vad = new VoiceActivityDetector({
      thresholdOverNoiseDb: 12,
      attackMs: 40,
      releaseMs: 300,
      absoluteFloorDb: -55,
    });
    vad.update(nivel(-20));
    expect(por(vad, 20, nivel(-20))).toBe('SILENCE');
    expect(por(vad, 30, nivel(-20))).toBe('SPEAKING');
  });

  it('segura a fala nas pausas curtas e solta depois do release', () => {
    const vad = new VoiceActivityDetector();
    por(vad, 100, nivel(-20));
    expect(vad.current).toBe('SPEAKING');
    expect(por(vad, 200, nivel(-70))).toBe('SPEAKING');
    expect(por(vad, 200, nivel(-70))).toBe('SILENCE');
  });

  it('limiar acompanha o piso de ruido: ventilador alto nao conta como voz', () => {
    const vad = new VoiceActivityDetector();
    // Piso em -30 dB: precisa passar de -18 dB.
    expect(por(vad, 200, nivel(-25, -30))).toBe('SILENCE');
    expect(por(vad, 200, nivel(-10, -30))).toBe('SPEAKING');
  });

  it('piso absoluto: sala silenciosa nao faz o detector disparar com chiado', () => {
    const vad = new VoiceActivityDetector();
    // Piso -90 + 12 = -78, mas o piso absoluto e -55.
    expect(por(vad, 200, nivel(-60, -90))).toBe('SILENCE');
  });

  it('calibracao mede o ambiente e passa a usar esse piso', () => {
    const vad = new VoiceActivityDetector();
    vad.startCalibration(100);
    expect(vad.isCalibrating).toBe(true);
    por(vad, 120, nivel(-40, -80));
    expect(vad.isCalibrating).toBe(false);
    expect(vad.calibratedNoiseFloorDb).toBeCloseTo(-40);
    // Com piso calibrado em -40, -35 dB nao e voz.
    expect(por(vad, 200, nivel(-35, -80))).toBe('SILENCE');
  });

  it('reset volta ao silencio e esquece a calibracao', () => {
    const vad = new VoiceActivityDetector();
    vad.startCalibration(50);
    por(vad, 60, nivel(-40));
    por(vad, 100, nivel(-10));
    vad.reset();
    expect(vad.current).toBe('SILENCE');
    expect(vad.calibratedNoiseFloorDb).toBeNull();
  });
});
