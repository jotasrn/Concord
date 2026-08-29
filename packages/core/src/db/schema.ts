/**
 * Schema local. Duas camadas com papeis bem diferentes:
 *
 * 1. `ops` e a fonte da verdade - o log assinado, replicado entre peers.
 * 2. Todo o resto e projecao derivada, existindo so para a UI ler rapido.
 *
 * Isso significa que as tabelas de projecao podem ser apagadas e reconstruidas
 * a partir de `ops` a qualquer momento. Mudanca de schema na projecao nao
 * precisa de migration: basta reprojetar.
 */
export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------- fonte da verdade ----------

CREATE TABLE IF NOT EXISTS ops (
  id          TEXT PRIMARY KEY,
  type        TEXT    NOT NULL,
  author_key  TEXT    NOT NULL,
  server_id   TEXT    NOT NULL,
  seq         INTEGER NOT NULL,
  lamport     INTEGER NOT NULL,
  timestamp   INTEGER NOT NULL,
  payload     TEXT    NOT NULL,
  signature   TEXT    NOT NULL,
  -- Um autor nao pode ter dois ops na mesma posicao do proprio log.
  -- E o que impede um peer de reescrever o passado dele.
  UNIQUE (author_key, server_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_ops_ordem  ON ops (server_id, lamport, author_key, seq);
CREATE INDEX IF NOT EXISTS idx_ops_autor  ON ops (author_key, server_id, seq);

-- ---------- projecao ----------

CREATE TABLE IF NOT EXISTS users (
  user_key     TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  avatar       TEXT,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS servers (
  id         TEXT PRIMARY KEY,
  name       TEXT    NOT NULL,
  icon       TEXT,
  owner_key  TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  server_id    TEXT    NOT NULL,
  user_key     TEXT    NOT NULL,
  display_name TEXT    NOT NULL,
  permissions  TEXT    NOT NULL,
  joined_at    INTEGER NOT NULL,
  PRIMARY KEY (server_id, user_key),
  FOREIGN KEY (server_id) REFERENCES servers (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS channels (
  id          TEXT PRIMARY KEY,
  server_id   TEXT    NOT NULL,
  category_id TEXT,
  name        TEXT    NOT NULL,
  type        TEXT    NOT NULL CHECK (type IN ('TEXT', 'VOICE')),
  topic       TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  deleted     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (server_id) REFERENCES servers (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_channels_servidor ON channels (server_id, position);

CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  channel_id  TEXT    NOT NULL,
  server_id   TEXT    NOT NULL,
  author_key  TEXT    NOT NULL,
  content     TEXT    NOT NULL,
  reply_to_id TEXT,
  created_at  INTEGER NOT NULL,
  edited_at   INTEGER,
  deleted     INTEGER NOT NULL DEFAULT 0,
  -- Guardado para paginar na mesma ordem em que o reducer aplicou.
  lamport     INTEGER NOT NULL,
  FOREIGN KEY (channel_id) REFERENCES channels (id) ON DELETE CASCADE
);

-- Indice que sustenta a paginacao do chat, a query mais frequente do app.
CREATE INDEX IF NOT EXISTS idx_messages_canal ON messages (channel_id, lamport, id);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
