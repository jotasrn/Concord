import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateRecoveryPhrase, identityFromPhrase } from '../identity/keystore';
import { ConcordStore } from '../store';
import { openDatabase } from './database';

function pasta(): string {
  return mkdtempSync(join(tmpdir(), 'concord-db-'));
}

/** Chave crua de 32 bytes para abrir o banco diretamente nos testes. */
function chaveTeste(): Buffer {
  return Buffer.alloc(32, 7);
}

test('banco novo nasce cifrado: o arquivo nao contem texto em claro', () => {
  const dir = pasta();
  try {
    const identity = identityFromPhrase(generateRecoveryPhrase(), 'joao');
    const store = new ConcordStore(join(dir, 'concord.db'), identity);
    const serverId = store.createServer('Servidor Secreto');
    store.createChannel(serverId, 'canal-secreto');
    store.close();

    const bruto = readFileSync(join(dir, 'concord.db'));
    assert.equal(
      bruto.subarray(0, 16).toString('latin1') === 'SQLite format 3\0',
      false,
      'o cabecalho nao pode ser o de um SQLite em texto puro',
    );
    assert.equal(bruto.includes(Buffer.from('Servidor Secreto')), false, 'nome vazou em claro');
    assert.equal(bruto.includes(Buffer.from('canal-secreto')), false, 'canal vazou em claro');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sem a chave certa o banco nao abre', () => {
  const dir = pasta();
  try {
    const caminho = join(dir, 'concord.db');
    const identity = identityFromPhrase(generateRecoveryPhrase(), 'joao');
    const store = new ConcordStore(caminho, identity);
    store.createServer('Squad');
    store.close();

    assert.throws(
      () => {
        // Chave errada: o driver nao reconhece o arquivo como banco.
        const db = openDatabase(caminho, chaveTeste());
        try {
          db.prepare('SELECT 1').get();
        } finally {
          db.close();
        }
      },
      /not a database|file is not|SQLITE_NOTADB/i,
      'abrir com a chave errada deveria falhar',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a mesma identidade reabre o banco cifrado e le os dados', () => {
  const dir = pasta();
  try {
    const caminho = join(dir, 'concord.db');
    const phrase = generateRecoveryPhrase();

    const store1 = new ConcordStore(caminho, identityFromPhrase(phrase, 'joao'));
    const serverId = store1.createServer('Squad');
    store1.close();

    const store2 = new ConcordStore(caminho, identityFromPhrase(phrase, 'joao'));
    assert.ok(
      store2.listServers().some((s) => s.id === serverId && s.name === 'Squad'),
      'os dados precisam reabrir com a mesma frase',
    );
    store2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('banco legado em texto puro e migrado para cifrado na primeira abertura', () => {
  const dir = pasta();
  try {
    const caminho = join(dir, 'concord.db');
    const phrase = generateRecoveryPhrase();

    // Simula a versao antiga: banco em texto puro (openDatabase sem chave),
    // com um servidor gravado nele.
    const legado = openDatabase(caminho);
    legado
      .prepare('INSERT INTO servers (id, name, icon, owner_key, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('srv-legado', 'Servidor Legado', null, 'a'.repeat(64), Date.now());
    legado.close();

    assert.equal(
      readFileSync(caminho).subarray(0, 16).toString('latin1'),
      'SQLite format 3\0',
      'o banco legado comeca em texto puro',
    );

    // Abrir pela ConcordStore (que passa a chave) dispara a migracao.
    const store = new ConcordStore(caminho, identityFromPhrase(phrase, 'joao'));
    assert.ok(
      store.listServers().some((s) => s.id === 'srv-legado'),
      'o conteudo legado precisa sobreviver a migracao',
    );
    store.close();

    const bruto = readFileSync(caminho);
    assert.notEqual(
      bruto.subarray(0, 16).toString('latin1'),
      'SQLite format 3\0',
      'apos a migracao o arquivo nao pode mais estar em texto puro',
    );
    assert.equal(
      bruto.includes(Buffer.from('Servidor Legado')),
      false,
      'o nome legado nao pode continuar legivel no disco',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
