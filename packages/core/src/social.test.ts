import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from './crypto/vault';
import { openDatabase, openInMemoryDatabase } from './db/database';
import { SocialStore } from './social';

function novoVault(): Vault {
  return new Vault(randomBytes(32));
}

/**
 * Regressao de uma falha "Media" encontrada em revisao de seguranca:
 * `pending_invites` era unico so por `server_id`, entao qualquer peer que
 * soubesse o serverId de um convite ja pendente conseguia sobrescrever o
 * codigo (e o remetente) do convite legitimo de um amigo - a vitima aceitaria
 * achando que era do amigo. A chave composta (server_id, from_key) impede
 * isso: cada remetente tem sua propria linha.
 */
test('convites pendentes do mesmo servidor, de remetentes diferentes, nao se sobrescrevem', () => {
  const social = new SocialStore(openInMemoryDatabase(), novoVault());

  social.addPendingInvite({
    serverId: 'srv1',
    serverName: 'Squad',
    fromKey: 'amigo'.padEnd(64, '0'),
    code: 'codigo-do-amigo',
  });
  social.addPendingInvite({
    serverId: 'srv1',
    serverName: 'Squad (forjado)',
    fromKey: 'atacante'.padEnd(64, '1'),
    code: 'codigo-do-atacante',
  });

  const convites = social.listPendingInvites();
  assert.equal(convites.length, 2, 'os dois convites precisam coexistir');
  assert.ok(convites.some((c) => c.code === 'codigo-do-amigo'));
  assert.ok(convites.some((c) => c.code === 'codigo-do-atacante'));
});

test('reenviar do MESMO remetente atualiza so o proprio convite dele', () => {
  const social = new SocialStore(openInMemoryDatabase(), novoVault());
  const fromKey = 'amigo'.padEnd(64, '0');

  social.addPendingInvite({ serverId: 'srv1', serverName: 'Squad', fromKey, code: 'v1' });
  social.addPendingInvite({ serverId: 'srv1', serverName: 'Squad', fromKey, code: 'v2' });

  const convites = social.listPendingInvites();
  assert.equal(convites.length, 1);
  assert.equal(convites[0].code, 'v2');
});

test('aceitar/recusar remove todos os convites daquele servidor, de qualquer remetente', () => {
  const social = new SocialStore(openInMemoryDatabase(), novoVault());
  social.addPendingInvite({
    serverId: 'srv1',
    serverName: 'Squad',
    fromKey: 'a'.padEnd(64, '0'),
    code: 'c1',
  });
  social.addPendingInvite({
    serverId: 'srv1',
    serverName: 'Squad',
    fromKey: 'b'.padEnd(64, '1'),
    code: 'c2',
  });

  social.removePendingInvite('srv1');
  assert.equal(social.listPendingInvites().length, 0);
});

test('banco de versao anterior (chave so em server_id) migra sem perder convites', () => {
  const dir = mkdtempSync(join(tmpdir(), 'concord-migracao-'));
  const path = join(dir, 'concord.db');

  try {
    // Simula o esquema ANTIGO, antes da chave composta.
    const antigo = openDatabase(path);
    antigo.exec('DROP TABLE pending_invites');
    antigo.exec(`
      CREATE TABLE pending_invites (
        server_id   TEXT PRIMARY KEY,
        server_name TEXT NOT NULL,
        from_key    TEXT NOT NULL,
        code        TEXT NOT NULL,
        created_at  INTEGER NOT NULL
      );
    `);
    antigo
      .prepare(
        'INSERT INTO pending_invites (server_id, server_name, from_key, code, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('srv-legado', 'Squad Antigo', 'x'.padEnd(64, '0'), 'codigo-legado', Date.now());
    antigo.close();

    // Reabrir dispara addMissingColumns -> migratePendingInvitesKey.
    const vault = novoVault();
    const db = openDatabase(path);
    const social = new SocialStore(db, vault);
    const convites = social.listPendingInvites();

    assert.equal(convites.length, 1, 'convite legado precisa sobreviver a migracao');
    assert.equal(convites[0].serverId, 'srv-legado');
    // O codigo nao estava cifrado no formato antigo (era texto puro nesta
    // simulacao) - o Vault tolera isso e devolve como veio, documentado em
    // vault.ts como compatibilidade com dado legado.
    assert.equal(convites[0].code, 'codigo-legado');

    // E a tabela nova aceita a chave composta sem erro.
    social.addPendingInvite({
      serverId: 'srv-legado',
      serverName: 'Squad Antigo',
      fromKey: 'y'.padEnd(64, '1'),
      code: 'segundo-convite',
    });
    assert.equal(social.listPendingInvites().length, 2);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
