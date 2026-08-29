import { randomUUID } from 'node:crypto';
import { Identity } from './identity/keystore';
import { toHex } from './identity/keypair';
import {
  Db,
  currentLamport,
  getOperations,
  insertOperation,
  nextSeq,
  openDatabase,
} from './db/database';
import { createOperation, verifyOperation } from './ops/sign';
import { rebuildProjection } from './ops/reducer';
import { OpPayload, OpType, Operation } from './ops/types';

export interface ChannelView {
  id: string;
  serverId: string;
  name: string;
  type: 'TEXT' | 'VOICE';
  topic: string | null;
  position: number;
}

export interface MessageView {
  id: string;
  channelId: string;
  authorKey: string;
  authorName: string;
  content: string;
  replyToId: string | null;
  createdAt: number;
  editedAt: number | null;
}

export interface ServerView {
  id: string;
  name: string;
  icon: string | null;
  ownerKey: string;
}

export interface MemberView {
  userKey: string;
  displayName: string;
  permissions: string;
}

/**
 * Une identidade, log local e projecao. E a unica porta de entrada que a UI
 * usa - ela nunca fala com o SQLite nem com a rede diretamente.
 */
export class ConcordStore {
  readonly db: Db;
  readonly identity: Identity;
  readonly publicKeyHex: string;

  constructor(dbPath: string, identity: Identity) {
    this.db = openDatabase(dbPath);
    this.identity = identity;
    this.publicKeyHex = toHex(identity.publicKey);
  }

  /** Cria, assina e aplica uma operacao local. */
  private commit(type: OpType, serverId: string, payload: OpPayload): Operation {
    const op = createOperation(
      {
        type,
        authorKey: this.publicKeyHex,
        serverId,
        seq: nextSeq(this.db, this.publicKeyHex, serverId),
        lamport: currentLamport(this.db, serverId) + 1,
        timestamp: Date.now(),
        payload,
      },
      this.identity.privateKey,
    );

    insertOperation(this.db, op);
    rebuildProjection(this.db);
    return op;
  }

  /**
   * Integra operacoes recebidas de peers. Operacoes com assinatura invalida sao
   * descartadas antes de tocar o banco; as demais entram no log e a projecao e
   * reconstruida.
   */
  applyRemoteOperations(ops: Operation[]): { accepted: number; discarded: number } {
    let accepted = 0;
    let discarded = 0;

    for (const op of ops) {
      if (!verifyOperation(op)) {
        discarded++;
        continue;
      }
      if (insertOperation(this.db, op)) accepted++;
    }

    if (accepted > 0) rebuildProjection(this.db);
    return { accepted, discarded };
  }

  operationsFor(serverId: string): Operation[] {
    return getOperations(this.db, serverId);
  }

  // ---------- comandos ----------

  createServer(name: string, icon: string | null = null): string {
    const serverId = randomUUID();
    this.commit('server.create', serverId, {
      serverId,
      name,
      icon,
      ownerDisplayName: this.identity.displayName,
    });
    return serverId;
  }

  addMember(serverId: string, userKey: string, displayName: string): void {
    this.commit('member.join', serverId, { userKey, displayName, inviteCode: null });
  }

  createChannel(
    serverId: string,
    name: string,
    type: 'TEXT' | 'VOICE' = 'TEXT',
    position = 0,
  ): string {
    const channelId = randomUUID();
    this.commit('channel.create', serverId, {
      channelId,
      name,
      type,
      categoryId: null,
      position,
    });
    return channelId;
  }

  sendMessage(
    serverId: string,
    channelId: string,
    content: string,
    replyToId: string | null = null,
  ): string {
    const messageId = randomUUID();
    this.commit('message.create', serverId, { messageId, channelId, content, replyToId });
    return messageId;
  }

  editMessage(serverId: string, messageId: string, content: string): void {
    this.commit('message.edit', serverId, { messageId, content });
  }

  deleteMessage(serverId: string, messageId: string): void {
    this.commit('message.delete', serverId, { messageId });
  }

  // ---------- consultas ----------

  listServers(): ServerView[] {
    return this.db
      .prepare('SELECT id, name, icon, owner_key FROM servers ORDER BY created_at')
      .all()
      .map((r) => {
        const row = r as { id: string; name: string; icon: string | null; owner_key: string };
        return { id: row.id, name: row.name, icon: row.icon, ownerKey: row.owner_key };
      });
  }

  listChannels(serverId: string): ChannelView[] {
    return this.db
      .prepare(
        `SELECT id, server_id, name, type, topic, position FROM channels
         WHERE server_id = ? AND deleted = 0 ORDER BY position, name`,
      )
      .all(serverId)
      .map((r) => {
        const row = r as {
          id: string;
          server_id: string;
          name: string;
          type: 'TEXT' | 'VOICE';
          topic: string | null;
          position: number;
        };
        return {
          id: row.id,
          serverId: row.server_id,
          name: row.name,
          type: row.type,
          topic: row.topic,
          position: row.position,
        };
      });
  }

  listMembers(serverId: string): MemberView[] {
    return this.db
      .prepare(
        'SELECT user_key, display_name, permissions FROM members WHERE server_id = ? ORDER BY joined_at',
      )
      .all(serverId)
      .map((r) => {
        const row = r as { user_key: string; display_name: string; permissions: string };
        return {
          userKey: row.user_key,
          displayName: row.display_name,
          permissions: row.permissions,
        };
      });
  }

  /** Historico do canal, mais antigas primeiro, paginado por keyset. */
  listMessages(channelId: string, limit = 50, beforeLamport?: number): MessageView[] {
    const rows = beforeLamport
      ? this.db
          .prepare(
            `SELECT m.*, COALESCE(u.display_name, '') AS author_name
             FROM messages m LEFT JOIN users u ON u.user_key = m.author_key
             WHERE m.channel_id = ? AND m.deleted = 0 AND m.lamport < ?
             ORDER BY m.lamport DESC, m.id DESC LIMIT ?`,
          )
          .all(channelId, beforeLamport, limit)
      : this.db
          .prepare(
            `SELECT m.*, COALESCE(u.display_name, '') AS author_name
             FROM messages m LEFT JOIN users u ON u.user_key = m.author_key
             WHERE m.channel_id = ? AND m.deleted = 0
             ORDER BY m.lamport DESC, m.id DESC LIMIT ?`,
          )
          .all(channelId, limit);

    return rows
      .map((r) => {
        const row = r as {
          id: string;
          channel_id: string;
          author_key: string;
          author_name: string;
          content: string;
          reply_to_id: string | null;
          created_at: number;
          edited_at: number | null;
        };
        return {
          id: row.id,
          channelId: row.channel_id,
          authorKey: row.author_key,
          authorName: row.author_name,
          content: row.content,
          replyToId: row.reply_to_id,
          createdAt: row.created_at,
          editedAt: row.edited_at,
        };
      })
      .reverse();
  }

  close(): void {
    this.db.close();
  }
}
