import {
  KeyObject,
  createPrivateKey,
  createPublicKey,
  sign as nodeSign,
  verify as nodeVerify,
} from 'node:crypto';

/**
 * Ed25519 pelo crypto nativo do Node, sem dependencia externa.
 *
 * A alternativa (@noble/ed25519) e ESM-only, e o processo principal do Electron
 * carrega CommonJS - o app nao subia. O nativo tambem e mais rapido, o que
 * importa porque o reducer valida a assinatura de toda operacao recebida.
 *
 * O Node so aceita chaves Ed25519 embrulhadas em DER, entao os prefixos abaixo
 * convertem entre os 32 bytes crus e o formato que a API exige.
 */
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export interface KeyPair {
  /** Semente privada de 32 bytes. Nunca sai do dispositivo em texto claro. */
  privateKey: Uint8Array;
  /** Chave publica de 32 bytes. E a identidade do usuario na rede. */
  publicKey: Uint8Array;
}

function privateKeyObject(seed: Uint8Array): KeyObject {
  return createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seed)]),
    format: 'der',
    type: 'pkcs8',
  });
}

function publicKeyObject(publicKey: Uint8Array): KeyObject {
  return createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKey)]),
    format: 'der',
    type: 'spki',
  });
}

/**
 * Cache de chaves publicas: verificar uma operacao exige montar o KeyObject a
 * partir do DER, e o reducer reprocessa o log inteiro a cada sincronizacao.
 */
const publicKeyCache = new Map<string, KeyObject>();
const PUBLIC_KEY_CACHE_LIMIT = 512;

function cachedPublicKey(publicKey: Uint8Array): KeyObject {
  const hex = toHex(publicKey);
  const cached = publicKeyCache.get(hex);
  if (cached) return cached;

  const key = publicKeyObject(publicKey);
  if (publicKeyCache.size >= PUBLIC_KEY_CACHE_LIMIT) {
    publicKeyCache.clear();
  }
  publicKeyCache.set(hex, key);
  return key;
}

export function keyPairFromSeed(seed: Uint8Array): KeyPair {
  if (seed.length !== 32) {
    throw new Error(`Seed precisa ter 32 bytes, recebeu ${seed.length}`);
  }
  const priv = privateKeyObject(seed);
  const spki = createPublicKey(priv).export({ format: 'der', type: 'spki' });
  // Os 32 bytes crus da chave publica ficam no fim do envelope SPKI.
  return { privateKey: seed, publicKey: new Uint8Array(spki.subarray(spki.length - 32)) };
}

export function sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array {
  // Ed25519 nao usa hash separado: o algoritmo vai como null.
  return new Uint8Array(nodeSign(null, Buffer.from(message), privateKeyObject(privateKey)));
}

export function verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    return nodeVerify(
      null,
      Buffer.from(message),
      cachedPublicKey(publicKey),
      Buffer.from(signature),
    );
  } catch {
    // Assinatura ou chave malformada vinda de um peer hostil nao pode
    // derrubar o reducer.
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
