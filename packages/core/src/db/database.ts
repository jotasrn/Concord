import { existsSync, openSync, readSync, closeSync, copyFileSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3-multiple-ciphers';
import { Vault } from '../crypto/vault';
import { Operation } from '../ops/types';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';

export type Db = Database.Database;

/**
 * Todo arquivo SQLite em texto puro comeca com estes 16 bytes. Um banco
 * cifrado tem o cabecalho embaralhado junto do resto, entao a presenca exata
 * desta assinatura e o que distingue um banco legado (a migrar) de um ja
 * cifrado.
 */
const SQLITE_PLAINTEXT_HEADER = 'SQLite format 3\0';

/** Aplica a chave de cifragem crua (32 bytes) como `PRAGMA key`. */
function applyKey(db: Db, encryptionKey: Buffer): void {
  // Hex entre x'...' diz ao driver que a chave ja e material bruto de 256
  // bits - sem isso ele rodaria um KDF proprio por cima, desnecessario porque
  // a chave ja vem de um hash do seed da identidade.
  db.pragma(`key = "x'${encryptionKey.toString('hex')}'"`);
}

/** Le os primeiros bytes para saber se o arquivo e um SQLite em texto puro. */
function isPlaintextDatabase(path: string): boolean {
  if (!existsSync(path)) return false;
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(16);
    const lidos = readSync(fd, buf, 0, 16, 0);
    return lidos === 16 && buf.toString('latin1') === SQLITE_PLAINTEXT_HEADER;
  } finally {
    closeSync(fd);
  }
}

/**
 * Cifra um banco legado que estava em texto puro.
 *
 * Bancos criados antes desta versao gravavam tudo em claro: nome de servidor,
 * canais, membros e metadados do log ficavam legiveis para quem abrisse o
 * arquivo. Aqui o banco e cifrado no proprio lugar, uma unica vez, na primeira
 * abertura apos a atualizacao.
 *
 * `PRAGMA rekey` num banco aberto sem chave cifra o arquivo existente in-place,
 * reescrevendo cada pagina. Isso roda sobre o unico banco do usuario, com todo
 * o historico dele - entao, por seguranca, uma copia do arquivo em claro e
 * feita antes. Se a cifragem falhar no meio (disco cheio, queda de energia), o
 * backup e restaurado e a proxima abertura tenta de novo; so depois de
 * confirmar que o banco cifrado abre com a chave o backup e apagado.
 */
function encryptLegacyDatabase(path: string, encryptionKey: Buffer): void {
  const backup = `${path}.plaintext-bak`;
  copyFileSync(path, backup);

  try {
    const db = new Database(path);
    try {
      db.pragma(`rekey = "x'${encryptionKey.toString('hex')}'"`);
    } finally {
      db.close();
    }

    // Confirma que o resultado abre de fato com a chave antes de descartar o
    // backup - um rekey que "terminou" mas gerou arquivo ilegivel nao pode
    // levar o unico backup junto.
    const verif = new Database(path);
    try {
      applyKey(verif, encryptionKey);
      verif.prepare('SELECT count(*) FROM sqlite_master').get();
    } finally {
      verif.close();
    }

    rmSync(backup, { force: true });
  } catch (erro) {
    // Algo deu errado: devolve o arquivo em claro intacto. O usuario nao perde
    // nada; so continua sem cifra ate a proxima tentativa.
    copyFileSync(backup, path);
    rmSync(backup, { force: true });
    throw erro;
  }
}

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

  const members = colunas('members');
  if (!members.has('nickname')) db.exec('ALTER TABLE members ADD COLUMN nickname TEXT');
  if (!members.has('role_name')) db.exec('ALTER TABLE members ADD COLUMN role_name TEXT');
  if (!members.has('muted')) {
    db.exec('ALTER TABLE members ADD COLUMN muted INTEGER NOT NULL DEFAULT 0');
  }

  const users = colunas('users');
  if (!users.has('bio')) db.exec('ALTER TABLE users ADD COLUMN bio TEXT');
  if (!users.has('self_declared')) {
    db.exec('ALTER TABLE users ADD COLUMN self_declared INTEGER NOT NULL DEFAULT 0');
  }

  migratePendingInvitesKey(db);
}

/**
 * Troca a chave primaria de `pending_invites` de `server_id` sozinho para
 * `(server_id, from_key)` - SQLite nao tem `ALTER TABLE` para isso, entao a
 * tabela e recriada preservando as linhas existentes.
 *
 * So roda quando detecta o formato antigo (uma unica coluna na chave).
 */
function migratePendingInvitesKey(db: Db): void {
  const pk = (
    db.prepare('PRAGMA table_info(pending_invites)').all() as { name: string; pk: number }[]
  ).filter((c) => c.pk > 0);
  const jaMigrado = pk.length !== 1 || pk[0]?.name !== 'server_id';
  if (jaMigrado) return;

  db.exec(`
    ALTER TABLE pending_invites RENAME TO pending_invites_old;
    CREATE TABLE pending_invites (
      server_id   TEXT NOT NULL,
      server_name TEXT NOT NULL,
      from_key    TEXT NOT NULL,
      code        TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      PRIMARY KEY (server_id, from_key)
    );
    INSERT INTO pending_invites SELECT * FROM pending_invites_old;
    DROP TABLE pending_invites_old;
  `);
}

/**
 * Abre (e cria, se preciso) o banco local.
 *
 * Com `encryptionKey`, o arquivo em disco fica cifrado (ChaCha20) e so abre
 * com a mesma chave; um banco legado em texto puro e migrado na primeira vez.
 * Sem chave - em memoria ou em testes - o banco fica em claro, o que nao tem
 * problema porque nunca toca o disco do usuario.
 */
export function openDatabase(path: string, encryptionKey?: Buffer): Db {
  if (encryptionKey && path !== ':memory:' && isPlaintextDatabase(path)) {
    encryptLegacyDatabase(path, encryptionKey);
  }

  const db = new Database(path);
  try {
    // A chave precisa ser aplicada antes de qualquer leitura: e ela que torna o
    // arquivo inteligivel.
    if (encryptionKey && path !== ':memory:') applyKey(db, encryptionKey);

    db.exec(SCHEMA_SQL);
    addMissingColumns(db);
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
      'schema_version',
      String(SCHEMA_VERSION),
    );
    return db;
  } catch (erro) {
    // Chave errada ou arquivo corrompido: fecha o handle antes de propagar,
    // senao o arquivo fica travado (o processo nem conseguiria apaga-lo).
    db.close();
    throw erro;
  }
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
  const row = db.prepare('SELECT key_hex FROM server_keys WHERE server_id = ?').get(serverId) as
    { key_hex: string } | undefined;
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
