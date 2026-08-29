import { createHash } from 'node:crypto';
import { fromHex, sign, toHex, verify } from '../identity/keypair';
import { canonicalBytes } from './canonical';
import { Operation, SignedFields } from './types';

/** sha256 pelo crypto nativo, evitando dependencia ESM-only no Electron. */
function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function opDigest(fields: SignedFields): Uint8Array {
  return canonicalBytes({
    type: fields.type,
    authorKey: fields.authorKey,
    serverId: fields.serverId,
    seq: fields.seq,
    lamport: fields.lamport,
    timestamp: fields.timestamp,
    payload: fields.payload,
  });
}

export function createOperation(fields: SignedFields, privateKey: Uint8Array): Operation {
  const digest = opDigest(fields);
  return {
    ...fields,
    id: sha256Hex(digest),
    signature: toHex(sign(digest, privateKey)),
  };
}

/**
 * Valida uma operacao recebida de um peer. Qualquer falha aqui significa
 * descartar a operacao silenciosamente: um peer hostil nao pode derrubar o
 * reducer nem injetar estado.
 */
export function verifyOperation(op: Operation): boolean {
  try {
    const digest = opDigest(op);

    // O id e derivado do conteudo: se nao bater, a operacao foi adulterada.
    if (sha256Hex(digest) !== op.id) return false;

    // A assinatura prova que o dono de authorKey autorizou exatamente estes bytes.
    return verify(fromHex(op.signature), digest, fromHex(op.authorKey));
  } catch {
    return false;
  }
}

/**
 * Ordem total deterministica.
 *
 * Lamport preserva causalidade (se A causou B, A vem antes). Empates entre
 * operacoes concorrentes sao desempatados por authorKey e seq, que sao
 * arbitrarios mas **iguais em todos os peers** - e isso que faz todo mundo
 * convergir para o mesmo estado.
 */
export function compareOperations(a: Operation, b: Operation): number {
  if (a.lamport !== b.lamport) return a.lamport - b.lamport;
  if (a.authorKey !== b.authorKey) return a.authorKey < b.authorKey ? -1 : 1;
  if (a.seq !== b.seq) return a.seq - b.seq;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortOperations(ops: Operation[]): Operation[] {
  return [...ops].sort(compareOperations);
}
