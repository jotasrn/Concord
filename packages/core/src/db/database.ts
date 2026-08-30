import Database from 'better-sqlite3';
import { Vault } from '../crypto/vault';
import { Operation } from '../ops/types';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';

export type Db = Database.Database;

/**
 * Acrescenta colunas que apareceram depois da primeira versao.
 *
 * CREATE TABLE IF NOT EXISTS nao altera tabela existente, entao bancos criados
 * em versoes anteriores ficariam sem as colunas novas.
 */
function addMissingColumns(db: Db): void {
  const colunas = (tabela: string) =>
    new Set(
      (db.prepare(`PRAGMA table_info(${tabela})`).all() as { name: string }[]).map((c) => c.name),
    );

  const users = colunas('users');
  if (!users.has('bio')) db.exec('ALTER TABLE users ADD COLUMN bio TEXT');
  if (!users.has('self_declared')) {
    db.exec('ALTER TABLE users ADD COLUMN self_declared INTEGER NOT NULL DEFAULT 0');
  }
}

export function openDatabase(path: string): Db {
  const db = new Database(path);
  db.exec(SCHEMA_SQL);
  addMissingColumns(db);
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
    'schema_version',
    String(SCHEMA_VERSION),
  );
  return db;
}

export function openInMemoryDatabase(): Db {
  return openDatabase(':memory:');
}

interface OpRow {
  id: string;
  type: string;
  author_key: string;
  server_id: string;
  seq: number;
  lamport: number;
  timestamp: number;
  payload: string;
  signature: string;
}

function rowToOperation(row: OpRow, vault: Vault): Operation {
  return {
    id: row.id,
    type: row.type as Operation['type'],
    authorKey: row.author_key,
    serverId: row.server_id,
    seq: row.seq,
    lamport: row.lamport,
    timestamp: row.timestamp,
    payload: JSON.parse(vault.open(row.payload)),
    signature: row.signature,
  };
}

/**
 * Grava a operacao no log. Retorna false se ela ja era conhecida - o que e
 * comum e esperado, ja que o mesmo op chega por varios peers.
 */
export function insertOperation(db: Db, op: Operation, vault: Vault): boolean {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO ops
         (id, type, author_key, server_id, seq, lamport, timestamp, payload, signature)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      op.id,
      op.type,
      op.authorKey,
      op.serverId,
      op.seq,
      op.lamport,
      op.timestamp,
      vault.seal(JSON.stringify(op.payload)),
      op.signature,
    );
  return result.changes > 0;
}

export function getOperations(db: Db, serverId: string, vault: Vault): Operation[] {
  return db
    .prepare(
      `SELECT * FROM ops WHERE server_id = ?
       ORDER BY lamport ASC, author_key ASC, seq ASC`,
    )
    .all(serverId)
    .map((row) => rowToOperation(row as OpRow, vault));
}

export function getAllOperations(db: Db, vault: Vault): Operation[] {
  return db
    .prepare(`SELECT * FROM ops ORDER BY server_id, lamport ASC, author_key ASC, seq ASC`)
    .all()
    .map((row) => rowToOperation(row as OpRow, vault));
}

/** Maior lamport conhecido: base para carimbar a proxima operacao local. */
export function currentLamport(db: Db, serverId: string): number {
  const row = db
    .prepare('SELECT MAX(lamport) AS max_lamport FROM ops WHERE server_id = ?')
    .get(serverId) as { max_lamport: number | null };
  return row.max_lamport ?? 0;
}

/** Proximo seq do proprio autor neste servidor. */
export function nextSeq(db: Db, authorKey: string, serverId: string): number {
  const row = db
    .prepare('SELECT MAX(seq) AS max_seq FROM ops WHERE author_key = ? AND server_id = ?')
    .get(authorKey, serverId) as { max_seq: number | null };
  return row.max_seq === null ? 0 : row.max_seq + 1;
}

/** Apaga apenas a projecao. O log permanece intacto para ser reprojetado. */
export function clearProjection(db: Db): void {
  db.exec(`
    DELETE FROM messages;
    DELETE FROM channels;
    DELETE FROM members;
    DELETE FROM servers;
    DELETE FROM users;
  `);
}

// ---------- chaves de servidor ----------

export function saveServerKey(db: Db, serverId: string, key: Buffer, vault: Vault): void {
  db.prepare(
    `INSERT INTO server_keys (server_id, key_hex, added_at) VALUES (?, ?, ?)
     ON CONFLICT (server_id) DO UPDATE SET key_hex = excluded.key_hex`,
  ).run(serverId, vault.seal(key.toString('hex')), Date.now());
}

export function getServerKey(db: Db, serverId: string, vault: Vault): Buffer | null {
  const row = db
    .prepare('SELECT key_hex FROM server_keys WHERE server_id = ?')
    .get(serverId) as { key_hex: string } | undefined;
  return row ? Buffer.from(vault.open(row.key_hex), 'hex') : null;
}

/** Todos os servidores cujo conteudo conseguimos ler. */
export function listServerKeys(db: Db, vault: Vault): { serverId: string; key: Buffer }[] {
  return db
    .prepare('SELECT server_id, key_hex FROM server_keys ORDER BY added_at')
    .all()
    .map((r) => {
      const row = r as { server_id: string; key_hex: string };
      return { serverId: row.server_id, key: Buffer.from(vault.open(row.key_hex), 'hex') };
    });
}
