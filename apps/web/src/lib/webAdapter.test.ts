import { describe, expect, it } from 'vitest';
import { deviceToken } from './webAdapter';

function memoria(inicial: Record<string, string> = {}) {
  const dados = new Map(Object.entries(inicial));
  return {
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => void dados.set(k, v),
    dados,
  };
}

describe('deviceToken', () => {
  it('gera 32 bytes hex e reaproveita o mesmo nas proximas aberturas', () => {
    const s = memoria();
    const t = deviceToken(s);
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(deviceToken(s)).toBe(t);
  });

  it('substitui valor salvo corrompido', () => {
    const s = memoria({ 'concord.device': '../../etc' });
    expect(deviceToken(s)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('funciona sem armazenamento (aba anonima restrita)', () => {
    const quebrado = {
      getItem: () => null,
      setItem: () => {
        throw new Error('bloqueado');
      },
    };
    expect(deviceToken(quebrado)).toMatch(/^[0-9a-f]{64}$/);
    expect(deviceToken(null)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('tokens de navegadores diferentes nao colidem', () => {
    expect(deviceToken(memoria())).not.toBe(deviceToken(memoria()));
  });
});
