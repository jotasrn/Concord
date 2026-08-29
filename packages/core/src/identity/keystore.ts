import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { KeyPair, keyPairFromSeed, toHex } from './keypair';

/**
 * Parametros do scrypt. N=65536 usa ~64MB e leva ~0.5s num desktop comum:
 * imperceptivel ao desbloquear, mas caro o suficiente para inviabilizar
 * forca bruta offline se o arquivo do keystore vazar.
 */
const SCRYPT_N = 65536;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 128 * 1024 * 1024;
const KEY_LENGTH = 32;

export interface EncryptedKeystore {
  version: 1;
  displayName: string;
  publicKey: string;
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
  createdAt: string;
}

export interface Identity extends KeyPair {
  displayName: string;
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password.normalize('NFKC'), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
}

/**
 * A frase BIP39 de 12 palavras E a conta. Sem servidor nao existe "esqueci
 * minha senha": esta frase e o unico caminho de recuperacao, e o usuario
 * precisa guarda-la fora do computador.
 */
export function generateRecoveryPhrase(): string {
  return generateMnemonic(wordlist, 128);
}

export function isValidRecoveryPhrase(phrase: string): boolean {
  return validateMnemonic(normalizePhrase(phrase), wordlist);
}

export function normalizePhrase(phrase: string): string {
  return phrase.trim().toLowerCase().split(/\s+/).join(' ');
}

/** Deriva o par de chaves a partir da frase. Sempre deterministico. */
export function identityFromPhrase(phrase: string, displayName: string): Identity {
  const normalized = normalizePhrase(phrase);
  if (!validateMnemonic(normalized, wordlist)) {
    throw new Error('Frase de recuperacao invalida');
  }
  const seed = mnemonicToSeedSync(normalized).subarray(0, 32);
  return { ...keyPairFromSeed(new Uint8Array(seed)), displayName };
}

export function encryptKeystore(
  phrase: string,
  password: string,
  displayName: string,
): EncryptedKeystore {
  const identity = identityFromPhrase(phrase, displayName);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(password, salt);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(normalizePhrase(phrase), 'utf8')),
    cipher.final(),
  ]);

  return {
    version: 1,
    displayName,
    publicKey: toHex(identity.publicKey),
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
    ciphertext: ciphertext.toString('hex'),
    createdAt: new Date().toISOString(),
  };
}

export function decryptKeystore(store: EncryptedKeystore, password: string): Identity {
  if (store.version !== 1) {
    throw new Error(`Versao de keystore nao suportada: ${store.version}`);
  }
  const key = deriveKey(password, Buffer.from(store.salt, 'hex'));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(store.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(store.authTag, 'hex'));

  let phrase: string;
  try {
    // O GCM autentica: senha errada falha aqui em vez de devolver lixo.
    phrase = Buffer.concat([
      decipher.update(Buffer.from(store.ciphertext, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Senha incorreta');
  }

  const identity = identityFromPhrase(phrase, store.displayName);
  if (toHex(identity.publicKey) !== store.publicKey) {
    throw new Error('Keystore corrompido: a chave publica nao confere');
  }
  return identity;
}
