import { randomUUID } from 'node:crypto';
import { Identity } from './identity/keystore';
import { toHex } from './identity/keypair';
import { decodeInvite, encodeInvite, generateServerKey } from './crypto/serverKey';
import { Vault } from './crypto/vault';
import {
  Db,
  currentLamport,
  getServerKey,
  listServerKeys,
  saveServerKey,
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
  /** Cifra o que vai para o disco. Existe so enquanto a conta esta destrancada. */
  private readonly vault: Vault;

  constructor(dbPath: string, identity: Identity) {
    this.db = openDatabase(dbPath);
    this.identity = identity;
    this.publicKeyHex = toHex(identity.publicKey);
    this.vault = new Vault(identity.privateKey);
  }

  /** Decifra o conteudo de uma mensagem vindo da projecao. */
  private openContent(stored: string): string {
    return this.vault.open(stored);
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

    insertOperation(this.db, op, this.vault);
    rebuildProjection(this.db, this.vault);
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
      if (insertOperation(this.db, op, this.vault)) accepted++;
    }

    if (accepted > 0) rebuildProjection(this.db, this.vault);
    return { accepted, discarded };
  }

  operationsFor(serverId: string): Operation[] {
    return getOperations(this.db, serverId, this.vault);
  }

  // ---------- comandos ----------

  // ---------- chaves e convites ----------

  /** Chave simetrica do servidor, ou null se nao participamos dele. */
  serverKey(serverId: string): Buffer | null {
    return getServerKey(this.db, serverId, this.vault);
  }

  knownServerKeys(): { serverId: string; key: Buffer }[] {
    return listServerKeys(this.db, this.vault);
  }

  /**
   * Gera chave para servidores que ainda nao tem uma.
   *
   * Servidores criados antes da cifragem por servidor ficaram sem chave, e sem
   * ela nao ha topico na DHT: eles simplesmente paravam de sincronizar sem
   * avisar. Aqui so o dono pode gerar, porque a chave precisa ser a mesma em
   * todos os peers - quem nao e dono depende de um convite novo.
   *
   * Retorna os servidores que continuam sem chave.
   */
  migrateServerKeys(): { migrados: string[]; semChave: ServerView[] } {
    const migrados: string[] = [];
    const semChave: ServerView[] = [];

    for (const server of this.listServers()) {
      if (getServerKey(this.db, server.id, this.vault)) continue;

      if (server.ownerKey === this.publicKeyHex) {
        saveServerKey(this.db, server.id, generateServerKey(), this.vault);
        migrados.push(server.id);
      } else {
        semChave.push(server);
      }
    }

    return { migrados, semChave };
  }

  /** Servidores que nao conseguem sincronizar por falta de chave. */
  serversWithoutKey(): ServerView[] {
    return this.listServers().filter((s) => !getServerKey(this.db, s.id, this.vault));
  }

  /** Codigo para dar a um amigo. Ele consegue ler o historico com isso. */
  createInvite(serverId: string): string {
    const key = getServerKey(this.db, serverId, this.vault);
    if (!key) {
      const server = this.listServers().find((s) => s.id === serverId);
      if (!server) throw new Error('Servidor desconhecido');
      throw new Error(
        server.ownerKey === this.publicKeyHex
          ? 'Este servidor foi criado numa versao anterior e nao tem chave. Reinicie o app para gerar uma.'
          : 'Voce nao tem a chave deste servidor. Peca um convite novo ao dono.',
      );
    }
    return encodeInvite(serverId, key);
  }

  /**
   * Guarda a chave vinda de um convite. Da acesso de LEITURA; escrever ainda
   * depende do dono publicar um member.join com a nossa chave publica.
   */
  acceptInvite(code: string): string {
    const invite = decodeInvite(code);
    if (!invite) throw new Error('Codigo de convite invalido');
    saveServerKey(this.db, invite.serverId, invite.serverKey, this.vault);
    return invite.serverId;
  }

  createServer(name: string, icon: string | null = null): string {
    const serverId = randomUUID();
    // A chave nasce junto com o servidor e define o topico da DHT.
    saveServerKey(this.db, serverId, generateServerKey(), this.vault);
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
          content: this.openContent(row.content),
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
