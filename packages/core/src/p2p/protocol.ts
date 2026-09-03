import { SealedPayload } from '../crypto/serverKey';
import { Operation } from '../ops/types';

/**
 * Protocolo de sincronizacao entre peers.
 *
 * Nao usa hypercore: o modelo aqui e multi-escritor (todo mundo escreve no
 * proprio log), e um hypercore por autor exigiria Autobase. Um protocolo
 * proprio sobre o stream do Hyperswarm e mais simples de auditar e resolve
 * exatamente o caso: "me diz onde voce parou, eu te mando o que falta".
 */
export type Message =
  /**
   * Desafio de identidade. O Hyperswarm autentica a chave EFEMERA da conexao,
   * nao a identidade Concord: sem esta prova, um peer poderia simplesmente
   * declarar a chave publica de outra pessoa e ser aceito.
   */
  | { t: 'auth:challenge'; nonce: string }
  | { t: 'auth:proof'; publicKey: string; signature: string }
  | { t: 'hello'; servers: string[] }
  | { t: 'have'; serverId: string; heads: Record<string, number> }
  | { t: 'want'; serverId: string; heads: Record<string, number> }
  // As operacoes viajam cifradas com a chave do servidor.
  | { t: 'ops'; serverId: string; sealed: SealedPayload }
  // Sinalizacao WebRTC e presenca de voz, cifradas com a chave do servidor.
  | { t: 'voice'; serverId: string; sealed: SealedPayload }
  // Presenca e efemera: vive na conexao, nunca entra no log.
  | { t: 'presence'; serverId: string; sealed: SealedPayload }
  /**
   * Pedidos que chegam pelo topico pessoal do destinatario. So sao aceitos de
   * peers que ja provaram a identidade.
   */
  | { t: 'friend:request'; displayName: string; avatar: string | null }
  | { t: 'friend:response'; accepted: boolean; displayName: string }
  | { t: 'invite:offer'; serverId: string; serverName: string; code: string };

/** Texto assinado na prova de identidade, com rotulo de dominio. */
export function authMessage(nonce: string): Uint8Array {
  return new TextEncoder().encode(`concord:auth:v1:${nonce}`);
}

/** Maior seq conhecido por autor. E o "onde eu parei" de cada log. */
export type Heads = Record<string, number>;

export function computeHeads(ops: Operation[]): Heads {
  const heads: Heads = {};
  for (const op of ops) {
    const current = heads[op.authorKey];
    if (current === undefined || op.seq > current) heads[op.authorKey] = op.seq;
  }
  return heads;
}

/**
 * Operacoes que o peer remoto ainda nao tem, dado o que ele declarou conhecer.
 * Autor ausente em `remoteHeads` significa que ele nao conhece nada daquele
 * autor, entao mandamos o log inteiro dele.
 */
export function operationsMissingFor(local: Operation[], remoteHeads: Heads): Operation[] {
  return local.filter((op) => {
    const known = remoteHeads[op.authorKey];
    return known === undefined || op.seq > known;
  });
}

const MAX_FRAME_BYTES = 8 * 1024 * 1024;

/**
 * Enquadramento por linha. JSON nunca contem \n literal fora de string
 * escapada, entao a quebra de linha e um delimitador seguro.
 */
export function encodeFrame(message: Message): Buffer {
  return Buffer.from(JSON.stringify(message) + '\n', 'utf8');
}

export class FrameDecoder {
  private buffer = '';

  /** Devolve as mensagens completas recebidas ate agora. */
  push(chunk: Buffer): Message[] {
    this.buffer += chunk.toString('utf8');

    if (this.buffer.length > MAX_FRAME_BYTES) {
      // Um peer hostil nao pode estourar a memoria mandando um frame infinito.
      this.buffer = '';
      throw new Error('Frame excedeu o tamanho maximo');
    }

    const messages: Message[] = [];
    let index: number;
    while ((index = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      if (!line.trim()) continue;
      try {
        messages.push(JSON.parse(line) as Message);
      } catch {
        // Linha corrompida e descartada; a conexao segue.
      }
    }
    return messages;
  }
}

/** Conteudo de uma mensagem de voz, apos decifrar. */
export interface VoiceSignal {
  kind: 'join' | 'leave' | 'offer' | 'answer' | 'ice' | 'state';
  /** Chave publica Concord de quem enviou. */
  from: string;
  /** Destinatario; ausente significa difusao para o canal. */
  to?: string;
  channelId: string;
  data?: unknown;
}

/** Status declarado por um peer. Nao e assinado nem persistido. */
export type PresenceStatus = 'ONLINE' | 'IDLE' | 'DND' | 'INVISIBLE';

export interface PeerPresence {
  status: PresenceStatus;
  voice: string | null;
}

export interface PresencePayload {
  status: PresenceStatus;
  /**
   * Canal de voz em que o peer esta agora, ou null.
   *
   * Viaja junto da presenca em vez de virar operacao: entrar e sair de call e
   * efemero, e registrar isso no log replicaria ruido para sempre.
   */
  voice?: string | null;
  /** Relogio do proprio peer, so para descartar mensagens fora de ordem. */
  at: number;
}

export const PRESENCE_STATUSES: PresenceStatus[] = ['ONLINE', 'IDLE', 'DND', 'INVISIBLE'];

export function isPresenceStatus(value: unknown): value is PresenceStatus {
  return typeof value === 'string' && (PRESENCE_STATUSES as string[]).includes(value);
}
