import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Chave simetrica por servidor.
 *
 * Antes o topico da DHT saia do serverId, entao qualquer um que descobrisse
 * esse UUID entrava no swarm e lia o historico inteiro - sem chance de revogar.
 * Agora o topico e derivado da chave do servidor: quem nao a tem nem encontra
 * os peers, e mesmo que encontrasse, as operacoes trafegam cifradas.
 */
export const SERVER_KEY_BYTES = 32;

export function generateServerKey(): Buffer {
  return randomBytes(SERVER_KEY_BYTES);
}

/**
 * Topico anunciado na DHT. Deriva da chave, e nao do serverId, com um rotulo
 * de dominio para que o mesmo material nunca seja reusado com outro proposito.
 */
export function topicFromServerKey(serverKey: Buffer): Buffer {
  return createHash('sha256').update('concord:topic:v1:').update(serverKey).digest();
}

/**
 * Topico pessoal de um usuario, derivado da chave publica dele.
 *
 * E o endereco por onde chegam pedidos de amizade e convites de servidor: sem
 * ele, so daria para falar com quem ja compartilha um servidor conosco, e
 * nunca haveria como iniciar o primeiro contato.
 *
 * Como a chave publica e feita para ser divulgada, qualquer um que a tenha
 * consegue entrar aqui. Por isso nada sensivel e enviado antes de o outro lado
 * provar que possui a chave privada correspondente.
 */
export function inboxTopic(publicKeyHex: string): Buffer {
  return createHash('sha256').update('concord:inbox:v1:').update(publicKeyHex).digest();
}

/**
 * Chave de cifragem separada da de topico. Derivar ambas do mesmo segredo por
 * caminhos distintos evita que publicar o topico (que vai para a DHT em texto
 * claro) revele qualquer coisa sobre a chave usada no conteudo.
 */
function contentKey(serverKey: Buffer): Buffer {
  return createHash('sha256').update('concord:content:v1:').update(serverKey).digest();
}

export interface SealedPayload {
  /** Nonce em base64. */
  n: string;
  /** Tag de autenticacao em base64. */
  t: string;
  /** Texto cifrado em base64. */
  c: string;
}

export function seal(serverKey: Buffer, plaintext: string): SealedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', contentKey(serverKey), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    n: iv.toString('base64'),
    t: cipher.getAuthTag().toString('base64'),
    c: encrypted.toString('base64'),
  };
}

/** Devolve null quando a autenticacao falha - chave errada ou dado adulterado. */
export function open(serverKey: Buffer, sealed: SealedPayload): string | null {
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      contentKey(serverKey),
      Buffer.from(sealed.n, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(sealed.t, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.c, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Codigo de convite: carrega o serverId e a chave. Quem recebe consegue achar
 * o servidor na DHT e ler o historico; escrever ainda exige que o dono publique
 * um member.join com a chave publica do convidado.
 */
export function encodeInvite(serverId: string, serverKey: Buffer): string {
  return Buffer.from(`${serverId}.${serverKey.toString('hex')}`, 'utf8').toString('base64url');
}

export function decodeInvite(code: string): { serverId: string; serverKey: Buffer } | null {
  try {
    const decoded = Buffer.from(code.trim(), 'base64url').toString('utf8');
    const separator = decoded.indexOf('.');
    if (separator === -1) return null;

    const serverId = decoded.slice(0, separator);
    const keyHex = decoded.slice(separator + 1);
    if (!/^[0-9a-f]{64}$/.test(keyHex)) return null;
    if (serverId.length === 0 || serverId.length > 128) return null;

    return { serverId, serverKey: Buffer.from(keyHex, 'hex') };
  } catch {
    return null;
  }
}
