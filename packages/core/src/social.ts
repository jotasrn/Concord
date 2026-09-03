import { Db } from './db/database';
import { Vault } from './crypto/vault';

export type FriendState = 'PENDING_IN' | 'PENDING_OUT' | 'ACCEPTED';

export interface Friend {
  userKey: string;
  displayName: string;
  avatar: string | null;
  state: FriendState;
  createdAt: number;
}

export interface PendingInvite {
  serverId: string;
  serverName: string;
  fromKey: string;
  code: string;
  createdAt: number;
}

/**
 * Amizades e convites pendentes.
 *
 * Ficam fora do log de operacoes de proposito: uma amizade e entre duas
 * pessoas e nao pertence a nenhum servidor, entao nao ha para onde replica-la.
 * Cada lado guarda a propria copia, e o acordo existe quando os dois guardaram.
 *
 * O codigo do convite carrega a chave do servidor, entao vai cifrado no disco
 * como todo o resto.
 */
export class SocialStore {
  constructor(
    private readonly db: Db,
    private readonly vault: Vault,
  ) {}

  // ---------- amigos ----------

  listFriends(): Friend[] {
    return this.db
      .prepare('SELECT * FROM friends ORDER BY state, display_name')
      .all()
      .map((r) => {
        const row = r as {
          user_key: string;
          display_name: string;
          avatar: string | null;
          state: FriendState;
          created_at: number;
        };
        return {
          userKey: row.user_key,
          displayName: row.display_name,
          avatar: row.avatar,
          state: row.state,
          createdAt: row.created_at,
        };
      });
  }

  getFriend(userKey: string): Friend | null {
    return this.listFriends().find((f) => f.userKey === userKey) ?? null;
  }

  /**
   * Grava um pedido, de entrada ou de saida.
   *
   * Se ja existe pedido no sentido oposto, os dois lados se querem: a amizade
   * vira ACCEPTED direto, sem precisar de mais uma rodada de confirmacao.
   */
  upsertFriend(
    userKey: string,
    displayName: string,
    avatar: string | null,
    state: FriendState,
  ): FriendState {
    const atual = this.getFriend(userKey);

    let finalState = state;
    if (atual?.state === 'ACCEPTED') {
      finalState = 'ACCEPTED';
    } else if (
      (atual?.state === 'PENDING_OUT' && state === 'PENDING_IN') ||
      (atual?.state === 'PENDING_IN' && state === 'PENDING_OUT')
    ) {
      finalState = 'ACCEPTED';
    }

    this.db
      .prepare(
        `INSERT INTO friends (user_key, display_name, avatar, state, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_key) DO UPDATE SET
           display_name = excluded.display_name,
           avatar       = excluded.avatar,
           state        = excluded.state`,
      )
      .run(userKey, displayName, avatar, finalState, atual?.createdAt ?? Date.now());

    return finalState;
  }

  removeFriend(userKey: string): void {
    this.db.prepare('DELETE FROM friends WHERE user_key = ?').run(userKey);
  }

  // ---------- convites de servidor ----------

  listPendingInvites(): PendingInvite[] {
    return this.db
      .prepare('SELECT * FROM pending_invites ORDER BY created_at DESC')
      .all()
      .map((r) => {
        const row = r as {
          server_id: string;
          server_name: string;
          from_key: string;
          code: string;
          created_at: number;
        };
        return {
          serverId: row.server_id,
          serverName: row.server_name,
          fromKey: row.from_key,
          // O codigo guarda a chave do servidor: nunca fica em claro no disco.
          code: this.vault.open(row.code),
          createdAt: row.created_at,
        };
      });
  }

  addPendingInvite(invite: Omit<PendingInvite, 'createdAt'>): void {
    this.db
      .prepare(
        `INSERT INTO pending_invites (server_id, server_name, from_key, code, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (server_id) DO UPDATE SET
           server_name = excluded.server_name,
           from_key    = excluded.from_key,
           code        = excluded.code`,
      )
      .run(
        invite.serverId,
        invite.serverName,
        invite.fromKey,
        this.vault.seal(invite.code),
        Date.now(),
      );
  }

  removePendingInvite(serverId: string): void {
    this.db.prepare('DELETE FROM pending_invites WHERE server_id = ?').run(serverId);
  }
}
