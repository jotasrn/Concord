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
  // 'me' e a chave publica Concord do peer. O id do Hyperswarm e efemero e
  // nao serve para enderecar sinalizacao de voz.
  | { t: 'hello'; servers: string[]; me: string }
  | { t: 'have'; serverId: string; heads: Record<string, number> }
  | { t: 'want'; serverId: string; heads: Record<string, number> }
  // As operacoes viajam cifradas com a chave do servidor.
  | { t: 'ops'; serverId: string; sealed: SealedPayload }
  // Sinalizacao WebRTC e presenca de voz, cifradas com a chave do servidor.
  | { t: 'voice'; serverId: string; sealed: SealedPayload };

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
