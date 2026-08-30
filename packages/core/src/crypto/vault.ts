import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Cifragem do banco local.
 *
 * O que ja era protegido: as operacoes viajam cifradas com a chave do servidor
 * dentro de um tunel Noise do Hyperswarm, e a midia de voz e video usa
 * DTLS-SRTP, que e obrigatorio no WebRTC. Em transito nada trafega em claro.
 *
 * O que faltava: o SQLite guardava mensagens em texto puro. Quem tivesse
 * acesso ao computador lia tudo sem precisar da senha - a senha protegia a
 * chave de identidade, nao o conteudo. O Vault fecha esse buraco.
 *
 * A chave e derivada da semente da identidade, que so existe em memoria depois
 * do desbloqueio. Sem a senha nao ha chave, e sem chave o banco e ruido.
 */
const VERSION = 'v1';
const PREFIX = `${VERSION}:`;

export class Vault {
  private readonly key: Buffer;

  constructor(identitySeed: Uint8Array) {
    if (identitySeed.length !== 32) {
      throw new Error('Semente de identidade invalida para o cofre');
    }
    // Rotulo de dominio: a mesma semente assina operacoes, e essas duas
    // funcoes nunca devem compartilhar material de chave.
    this.key = createHash('sha256')
      .update('concord:vault:v1:')
      .update(Buffer.from(identitySeed))
      .digest();
  }

  /**
   * Formato: `v1:nonce:tag:ciphertext`, tudo em base64.
   *
   * O prefixo de versao permite reconhecer texto legado (gravado antes da
   * cifragem) e migra-lo sem adivinhacao.
   */
  seal(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

    return [
      VERSION,
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      encrypted.toString('base64'),
    ].join(':');
  }

  /** Devolve o texto como esta se ele nao estiver cifrado (dado legado). */
  open(stored: string): string {
    if (!this.isSealed(stored)) return stored;

    const [, nonce, tag, payload] = stored.split(':');
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(nonce, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(payload, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      // Chave errada ou dado corrompido. Devolver vazio e melhor que derrubar
      // o app inteiro por causa de uma linha.
      return '';
    }
  }

  isSealed(value: string): boolean {
    return value.startsWith(PREFIX) && value.split(':').length === 4;
  }
}
