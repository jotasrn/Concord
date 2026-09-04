import { Permission } from '@concord/types';
import { Vault } from '../crypto/vault';
import { Db, clearProjection, getAllOperations } from '../db/database';
import { verifyOperation } from './sign';
import { validatePayload } from './validate';
import {
  ChannelCreatePayload,
  ChannelDeletePayload,
  ChannelUpdatePayload,
  MemberJoinPayload,
  MemberRolePayload,
  MemberNickPayload,
  MemberKickPayload,
  MemberMutePayload,
  MessageCreatePayload,
  MessageDeletePayload,
  MessageEditPayload,
  Operation,
  ServerCreatePayload,
  ServerUpdatePayload,
  UserProfilePayload,
} from './types';

export interface RejectedOperation {
  op: Operation;
  reason: string;
}

export interface ReduceResult {
  applied: number;
  rejected: RejectedOperation[];
}

function hasPerm(mask: string, permission: Permission): boolean {
  const bits = BigInt(mask);
  if (bits & BigInt(Permission.ADMINISTRATOR)) return true;
  return (bits & BigInt(permission)) === BigInt(permission);
}

function memberPermissions(db: Db, serverId: string, userKey: string): string | null {
  const row = db
    .prepare('SELECT permissions FROM members WHERE server_id = ? AND user_key = ?')
    .get(serverId, userKey) as { permissions: string } | undefined;
  return row?.permissions ?? null;
}

/**
 * Registra o nome que um terceiro atribuiu ao usuario ao adiciona-lo a um
 * servidor. Nunca sobrescreve um perfil que a propria pessoa declarou: quem
 * te adiciona nao decide como voce se chama.
 */
function upsertUser(db: Db, userKey: string, displayName: string, timestamp: number): void {
  db.prepare(
    `INSERT INTO users (user_key, display_name, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (user_key) DO UPDATE SET
       display_name = excluded.display_name,
       updated_at   = excluded.updated_at
     WHERE users.self_declared = 0 AND excluded.updated_at > users.updated_at`,
  ).run(userKey, displayName, timestamp);
}

/**
 * Aplica UMA operacao a projecao, assumindo que todas as operacoes anteriores
 * na ordem total ja foram aplicadas.
 *
 * Retorna null quando aplicada, ou o motivo da rejeicao. Rejeicao nao e erro:
 * um peer pode mandar qualquer coisa, e simplesmente ignoramos o que ele nao
 * tinha direito de fazer.
 */
function applyOne(db: Db, op: Operation, vault: Vault): string | null {
  switch (op.type) {
    case 'server.create': {
      const p = op.payload as ServerCreatePayload;
      const existing = db.prepare('SELECT id FROM servers WHERE id = ?').get(p.serverId);
      // O primeiro server.create vence. Ninguem pode "recriar" um servidor
      // existente para se tornar dono dele.
      if (existing) return 'servidor ja existe';
      if (p.serverId !== op.serverId) return 'serverId do payload nao confere';

      db.prepare(
        'INSERT INTO servers (id, name, icon, owner_key, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(p.serverId, p.name, p.icon, op.authorKey, op.timestamp);

      // O criador vira membro com ADMINISTRATOR no mesmo ato.
      db.prepare(
        `INSERT INTO members (server_id, user_key, display_name, permissions, joined_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(
        p.serverId,
        op.authorKey,
        p.ownerDisplayName,
        String(Permission.ADMINISTRATOR),
        op.timestamp,
      );
      upsertUser(db, op.authorKey, p.ownerDisplayName, op.timestamp);
      return null;
    }

    case 'server.update': {
      const p = op.payload as ServerUpdatePayload;
      const perms = memberPermissions(db, op.serverId, op.authorKey);
      if (!perms) return 'autor nao e membro';
      if (!hasPerm(perms, Permission.MANAGE_SERVER)) return 'sem MANAGE_SERVER';

      if (p.name !== undefined) {
        db.prepare('UPDATE servers SET name = ? WHERE id = ?').run(p.name, op.serverId);
      }
      if (p.icon !== undefined) {
        db.prepare('UPDATE servers SET icon = ? WHERE id = ?').run(p.icon, op.serverId);
      }
      return null;
    }

    case 'user.profile': {
      const p = op.payload as UserProfilePayload;

      // Perfil e sempre sobre si mesmo: nao ha campo de destinatario, o autor
      // da operacao e o dono. Isso impede alguem trocar a foto de outro.
      db.prepare(
        `INSERT INTO users (user_key, display_name, avatar, bio, self_declared, updated_at)
         VALUES (?, ?, ?, ?, 1, ?)
         ON CONFLICT (user_key) DO UPDATE SET
           display_name  = excluded.display_name,
           avatar        = excluded.avatar,
           bio           = excluded.bio,
           self_declared = 1,
           updated_at    = excluded.updated_at
         WHERE excluded.updated_at >= users.updated_at`,
      ).run(op.authorKey, p.displayName, p.avatar, p.bio, op.timestamp);

      // O nome exibido na lista de membros acompanha o perfil.
      db.prepare('UPDATE members SET display_name = ? WHERE user_key = ?').run(
        p.displayName,
        op.authorKey,
      );
      return null;
    }

    case 'member.join': {
      const p = op.payload as MemberJoinPayload;
      const server = db.prepare('SELECT owner_key FROM servers WHERE id = ?').get(op.serverId);
      if (!server) return 'servidor desconhecido';

      // Quem adiciona precisa de MANAGE_MEMBERS. Isso impede que qualquer um
      // se auto-adicione a um servidor que nao e dele.
      const perms = memberPermissions(db, op.serverId, op.authorKey);
      if (!perms) return 'autor nao e membro';
      if (!hasPerm(perms, Permission.MANAGE_MEMBERS)) return 'sem MANAGE_MEMBERS';

      const already = db
        .prepare('SELECT user_key FROM members WHERE server_id = ? AND user_key = ?')
        .get(op.serverId, p.userKey);
      if (already) return 'ja e membro';

      db.prepare(
        `INSERT INTO members (server_id, user_key, display_name, permissions, joined_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(
        op.serverId,
        p.userKey,
        p.displayName,
        String(
          Permission.VIEW_CHANNEL |
            Permission.SEND_MESSAGES |
            Permission.CONNECT |
            Permission.SPEAK |
            Permission.STREAM,
        ),
        op.timestamp,
      );
      upsertUser(db, p.userKey, p.displayName, op.timestamp);
      return null;
    }

    case 'member.role': {
      const p = op.payload as MemberRolePayload;
      const perms = memberPermissions(db, op.serverId, op.authorKey);
      if (!perms) return 'autor nao e membro';
      if (!hasPerm(perms, Permission.MANAGE_MEMBERS)) return 'sem MANAGE_MEMBERS';

      const server = db.prepare('SELECT owner_key FROM servers WHERE id = ?').get(op.serverId) as
        | { owner_key: string }
        | undefined;
      // O dono nunca pode ser rebaixado, nem por um admin.
      if (server?.owner_key === p.userKey) return 'o dono nao pode ser rebaixado';

      const changed = db
        .prepare(
          'UPDATE members SET permissions = ?, role_name = ? WHERE server_id = ? AND user_key = ?',
        )
        .run(p.permissions, p.roleName ?? null, op.serverId, p.userKey);
      return changed.changes > 0 ? null : 'membro nao encontrado';
    }

    case 'member.nick': {
      const p = op.payload as MemberNickPayload;
      const perms = memberPermissions(db, op.serverId, op.authorKey);
      if (!perms) return 'autor nao e membro';

      // Cada um pode mudar o proprio apelido; mexer no dos outros exige
      // permissao de gerenciar membros.
      const proprio = p.userKey === op.authorKey;
      if (!proprio && !hasPerm(perms, Permission.MANAGE_MEMBERS)) {
        return 'sem MANAGE_MEMBERS';
      }

      const changed = db
        .prepare('UPDATE members SET nickname = ? WHERE server_id = ? AND user_key = ?')
        .run(p.nickname, op.serverId, p.userKey);
      return changed.changes > 0 ? null : 'membro nao encontrado';
    }

    case 'member.kick': {
      const p = op.payload as MemberKickPayload;
      const perms = memberPermissions(db, op.serverId, op.authorKey);
      if (!perms) return 'autor nao e membro';
      if (!hasPerm(perms, Permission.KICK_MEMBERS)) return 'sem KICK_MEMBERS';

      const server = db.prepare('SELECT owner_key FROM servers WHERE id = ?').get(op.serverId) as
        | { owner_key: string }
        | undefined;
      // O dono nao pode ser expulso do proprio servidor.
      if (server?.owner_key === p.userKey) return 'o dono nao pode ser expulso';
      if (p.userKey === op.authorKey) return 'use sair do servidor';

      const changed = db
        .prepare('DELETE FROM members WHERE server_id = ? AND user_key = ?')
        .run(op.serverId, p.userKey);
      return changed.changes > 0 ? null : 'membro nao encontrado';
    }

    case 'member.mute': {
      const p = op.payload as MemberMutePayload;
      const perms = memberPermissions(db, op.serverId, op.authorKey);
      if (!perms) return 'autor nao e membro';
      if (!hasPerm(perms, Permission.MANAGE_MEMBERS)) return 'sem MANAGE_MEMBERS';

      const server = db.prepare('SELECT owner_key FROM servers WHERE id = ?').get(op.serverId) as
        | { owner_key: string }
        | undefined;
      if (server?.owner_key === p.userKey) return 'o dono nao pode ser silenciado';

      const changed = db
        .prepare('UPDATE members SET muted = ? WHERE server_id = ? AND user_key = ?')
        .run(p.muted ? 1 : 0, op.serverId, p.userKey);
      return changed.changes > 0 ? null : 'membro nao encontrado';
    }

    case 'channel.create': {
      const p = op.payload as ChannelCreatePayload;
      const perms = memberPermissions(db, op.serverId, op.authorKey);
      if (!perms) return 'autor nao e membro';
      if (!hasPerm(perms, Permission.MANAGE_CHANNELS)) return 'sem MANAGE_CHANNELS';
      if (db.prepare('SELECT id FROM channels WHERE id = ?').get(p.channelId)) {
        return 'canal ja existe';
      }

      db.prepare(
        `INSERT INTO channels (id, server_id, category_id, name, type, position, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(p.channelId, op.serverId, p.categoryId, p.name, p.type, p.position, op.timestamp);
      return null;
    }

    case 'channel.update': {
      const p = op.payload as ChannelUpdatePayload;
      const perms = memberPermissions(db, op.serverId, op.authorKey);
      if (!perms) return 'autor nao e membro';
      if (!hasPerm(perms, Permission.MANAGE_CHANNELS)) return 'sem MANAGE_CHANNELS';

      const channel = db
        .prepare('SELECT server_id FROM channels WHERE id = ?')
        .get(p.channelId) as { server_id: string } | undefined;
      if (!channel) return 'canal desconhecido';
      if (channel.server_id !== op.serverId) return 'canal e de outro servidor';

      if (p.name !== undefined) {
        db.prepare('UPDATE channels SET name = ? WHERE id = ?').run(p.name, p.channelId);
      }
      if (p.topic !== undefined) {
        db.prepare('UPDATE channels SET topic = ? WHERE id = ?').run(p.topic, p.channelId);
      }
      if (p.position !== undefined) {
        db.prepare('UPDATE channels SET position = ? WHERE id = ?').run(p.position, p.channelId);
      }
      return null;
    }

    case 'channel.delete': {
      const p = op.payload as ChannelDeletePayload;
      const perms = memberPermissions(db, op.serverId, op.authorKey);
      if (!perms) return 'autor nao e membro';
      if (!hasPerm(perms, Permission.MANAGE_CHANNELS)) return 'sem MANAGE_CHANNELS';

      const changed = db
        .prepare('UPDATE channels SET deleted = 1 WHERE id = ? AND server_id = ?')
        .run(p.channelId, op.serverId);
      return changed.changes > 0 ? null : 'canal desconhecido';
    }

    case 'message.create': {
      const p = op.payload as MessageCreatePayload;
      const perms = memberPermissions(db, op.serverId, op.authorKey);
      if (!perms) return 'autor nao e membro';
      if (!hasPerm(perms, Permission.SEND_MESSAGES)) return 'sem SEND_MESSAGES';

      const channel = db
        .prepare('SELECT server_id, deleted FROM channels WHERE id = ?')
        .get(p.channelId) as { server_id: string; deleted: number } | undefined;
      if (!channel) return 'canal desconhecido';
      if (channel.server_id !== op.serverId) return 'canal e de outro servidor';
      if (channel.deleted) return 'canal apagado';
      if (db.prepare('SELECT id FROM messages WHERE id = ?').get(p.messageId)) {
        return 'mensagem ja existe';
      }

      db.prepare(
        `INSERT INTO messages
           (id, channel_id, server_id, author_key, content, reply_to_id, created_at, lamport)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        p.messageId,
        p.channelId,
        op.serverId,
        op.authorKey,
        vault.seal(p.content),
        p.replyToId,
        op.timestamp,
        op.lamport,
      );
      return null;
    }

    case 'message.edit': {
      const p = op.payload as MessageEditPayload;
      const msg = db
        .prepare('SELECT author_key, deleted FROM messages WHERE id = ?')
        .get(p.messageId) as { author_key: string; deleted: number } | undefined;
      if (!msg) return 'mensagem desconhecida';
      // Editar e sempre exclusivo do autor - nem admin edita palavra alheia.
      if (msg.author_key !== op.authorKey) return 'so o autor pode editar';
      if (msg.deleted) return 'mensagem apagada';

      db.prepare('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?').run(
        vault.seal(p.content),
        op.timestamp,
        p.messageId,
      );
      return null;
    }

    case 'message.delete': {
      const p = op.payload as MessageDeletePayload;
      const msg = db
        .prepare('SELECT author_key FROM messages WHERE id = ?')
        .get(p.messageId) as { author_key: string } | undefined;
      if (!msg) return 'mensagem desconhecida';

      const perms = memberPermissions(db, op.serverId, op.authorKey);
      if (!perms) return 'autor nao e membro';
      // O autor apaga a propria; moderador apaga a de qualquer um.
      const isAuthor = msg.author_key === op.authorKey;
      if (!isAuthor && !hasPerm(perms, Permission.MANAGE_MEMBERS)) {
        return 'sem permissao para apagar mensagem alheia';
      }

      db.prepare("UPDATE messages SET deleted = 1, content = '' WHERE id = ?").run(p.messageId);
      return null;
    }

    default:
      return `tipo desconhecido: ${(op as Operation).type}`;
  }
}

/**
 * Reprojeta o estado a partir do zero, usando todo o log conhecido.
 *
 * Reconstruir tudo e o caminho seguro: como a ordem total e deterministica,
 * qualquer peer com o mesmo conjunto de operacoes chega ao mesmo resultado,
 * independente da ordem em que elas chegaram pela rede.
 */
export function rebuildProjection(db: Db, vault: Vault): ReduceResult {
  const ops = getAllOperations(db, vault);
  const rejected: RejectedOperation[] = [];
  let applied = 0;

  const run = db.transaction(() => {
    clearProjection(db);
    for (const op of ops) {
      if (!verifyOperation(op)) {
        rejected.push({ op, reason: 'assinatura invalida' });
        continue;
      }

      // Formato antes de conteudo: applyOne acessa campos do payload
      // diretamente, e um peer hostil pode mandar qualquer coisa.
      const invalido = validatePayload(op.type, op.payload);
      if (invalido) {
        rejected.push({ op, reason: invalido });
        continue;
      }

      try {
        const reason = applyOne(db, op, vault);
        if (reason) rejected.push({ op, reason });
        else applied++;
      } catch (error) {
        // Isolar cada operacao e essencial: sem isto, uma unica operacao
        // problematica aborta a transacao e a projecao inteira some - um peer
        // hostil derrubaria a sincronizacao de todos os outros.
        rejected.push({
          op,
          reason: `erro ao aplicar: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  });
  run();

  return { applied, rejected };
}
