/**
 * Serializacao canonica para assinatura.
 *
 * `JSON.stringify` preserva a ordem de insercao das chaves, entao o mesmo
 * objeto logico construido de formas diferentes gera bytes diferentes - e uma
 * assinatura que nao confere no outro peer. Aqui as chaves sao sempre
 * ordenadas, garantindo que a mesma operacao produza sempre os mesmos bytes em
 * qualquer maquina.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';

  const type = typeof value;

  if (type === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new Error('Numero nao finito nao pode ser canonicalizado');
    }
    return JSON.stringify(value);
  }

  if (type === 'string' || type === 'boolean') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }

  if (type === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      // `undefined` some no JSON.stringify normal; aqui e removido
      // explicitamente para que o resultado nao dependa desse detalhe.
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
  }

  throw new Error(`Tipo nao serializavel: ${type}`);
}

export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}
