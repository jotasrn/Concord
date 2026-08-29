import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

// @noble/ed25519 v2 e async por padrao. Registrar o hash sincrono habilita a
// API sync, que e o que o reducer de operacoes precisa (ele valida milhares de
// assinaturas em sequencia ao materializar os logs).
ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

export interface KeyPair {
  /** Chave privada de 32 bytes. Nunca sai do dispositivo em texto claro. */
  privateKey: Uint8Array;
  /** Chave publica de 32 bytes. E a identidade do usuario na rede. */
  publicKey: Uint8Array;
}

export function keyPairFromSeed(seed: Uint8Array): KeyPair {
  if (seed.length !== 32) {
    throw new Error(`Seed precisa ter 32 bytes, recebeu ${seed.length}`);
  }
  return { privateKey: seed, publicKey: ed.getPublicKey(seed) };
}

export function sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array {
  return ed.sign(message, privateKey);
}

export function verify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  try {
    return ed.verify(signature, message, publicKey);
  } catch {
    // Assinatura malformada vinda de um peer hostil nao pode derrubar o reducer.
    return false;
  }
}

export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

export function fromHex(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

/**
 * Sufixo curto e estavel derivado da chave publica, no formato `joao#a3f9`.
 *
 * Sem servidor central nao existe registro de nomes unicos: duas pessoas podem
 * escolher "joao". O fingerprint desambigua sem precisar de autoridade.
 */
export function fingerprint(publicKey: Uint8Array): string {
  return toHex(publicKey).slice(0, 4);
}

export function formatHandle(displayName: string, publicKey: Uint8Array): string {
  return `${displayName}#${fingerprint(publicKey)}`;
}
