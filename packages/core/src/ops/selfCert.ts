import { createHash, randomBytes } from 'node:crypto';

/**
 * IDs autocertificados.
 *
 * Um server.create (ou channel.create) e a PRIMEIRA operacao de uma historia
 * causal - nao ha nada antes dela para conferir permissao contra. "o primeiro
 * server.create vence" so e seguro se "primeiro" nao puder ser forjado, e no
 * log assinado a ordem de replay (lamport) e escolhida pelo PROPRIO autor. Um
 * impostor com a chave do servidor podia assinar um server.create com
 * lamport bem baixo e ganhar a corrida pela posse em todo peer que
 * reconstruisse a projecao.
 *
 * A correcao nao mexe em ordem nenhuma: ela torna impossivel que a operacao
 * do impostor sequer tenha o MESMO id da legitima. O id deixa de ser
 * escolhido livremente e passa a ser sha256(dono + nonce aleatorio) - uma
 * funcao de mao unica. Produzir um id que colida com um servidor existente
 * exigiria uma segunda-preimagem do SHA-256 (seria mais facil quebrar a
 * assinatura Ed25519 do que isso), entao a unica forma de "criar" aquele id e
 * realmente possui-lo desde o inicio.
 */

const SALT_LENGTH = 16;

/** Nonce aleatorio de 16 bytes, em hex. Sal unico por servidor/canal criado. */
export function newNonce(): string {
  return randomBytes(SALT_LENGTH).toString('hex');
}

/** sha256(ownerKeyHex + nonce), em hex - vira o id autocertificado. */
export function selfCertifiedId(ownerKeyHex: string, nonce: string): string {
  return createHash('sha256').update(ownerKeyHex + nonce).digest('hex');
}

/** Formato esperado do nonce: 32 chars hex (16 bytes). */
export function isValidNonce(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
}
