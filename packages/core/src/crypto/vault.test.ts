import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { generateRecoveryPhrase, identityFromPhrase } from '../identity/keystore';
import { toHex } from '../identity/keypair';
import { ConcordStore } from '../store';
import { Vault } from './vault';

function novaIdentidade(nome: string) {
  return identityFromPhrase(generateRecoveryPhrase(), nome);
}

test('seal/open faz round-trip', () => {
  const vault = new Vault(novaIdentidade('joao').privateKey);
  const texto = 'bora ranked as 20h';
  assert.equal(vault.open(vault.seal(texto)), texto);
});

test('identidade diferente nao decifra', () => {
  const a = new Vault(novaIdentidade('joao').privateKey);
  const b = new Vault(novaIdentidade('pedro').privateKey);
  assert.equal(b.open(a.seal('segredo')), '');
});

test('o mesmo texto cifra diferente a cada vez', () => {
  const vault = new Vault(novaIdentidade('joao').privateKey);
  assert.notEqual(vault.seal('igual'), vault.seal('igual'));
});

test('adulteracao e detectada pelo GCM', () => {
  const vault = new Vault(novaIdentidade('joao').privateKey);
  const selado = vault.seal('mensagem original');
  const partes = selado.split(':');
  const bytes = Buffer.from(partes[3], 'base64');
  bytes[0] ^= 0xff;
  partes[3] = bytes.toString('base64');
  assert.equal(vault.open(partes.join(':')), '');
});

test('texto legado nao cifrado passa direto', () => {
  const vault = new Vault(novaIdentidade('joao').privateKey);
  assert.equal(vault.open('mensagem antiga em texto puro'), 'mensagem antiga em texto puro');
  assert.equal(vault.isSealed('mensagem antiga em texto puro'), false);
});

test('o cofre recusa semente de tamanho errado', () => {
  assert.throws(() => new Vault(new Uint8Array(16)));
});

test('a chave do cofre difere da chave de assinatura', () => {
  // Mesma semente, propositos distintos: um vazamento do cofre nao pode
  // permitir assinar operacoes em nome do usuario.
  const identity = novaIdentidade('joao');
  const vault = new Vault(identity.privateKey);
  const selado = vault.seal('x');
  assert.equal(selado.includes(toHex(identity.privateKey)), false);
});

// ---------- o teste que importa: o disco ----------

test('o banco em disco nao contem mensagens legiveis', () => {
  const dir = mkdtempSync(join(tmpdir(), 'concord-vault-'));
  const caminho = join(dir, 'teste.db');

  try {
    const joao = novaIdentidade('joao');
    const store = new ConcordStore(caminho, joao);
    const serverId = store.createServer('Squad');
    const canal = store.createChannel(serverId, 'geral');

    const segredo = 'a senha do wifi e batatafrita123';
    store.sendMessage(serverId, canal, segredo);

    // Confere que o app le normalmente.
    assert.equal(store.listMessages(canal)[0].content, segredo);
    store.close();

    // E que o arquivo bruto nao entrega nada.
    const bruto = readFileSync(caminho);
    assert.equal(bruto.includes(Buffer.from(segredo)), false, 'a mensagem vazou no banco');
    assert.equal(bruto.includes(Buffer.from('batatafrita')), false, 'trecho da mensagem vazou');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a chave do servidor nao fica legivel no disco', () => {
  const dir = mkdtempSync(join(tmpdir(), 'concord-vault-'));
  const caminho = join(dir, 'teste.db');

  try {
    const store = new ConcordStore(caminho, novaIdentidade('joao'));
    const serverId = store.createServer('Squad');
    const chave = store.serverKey(serverId);
    assert.ok(chave, 'servidor criado deveria ter chave');
    store.close();

    const bruto = readFileSync(caminho);
    assert.equal(
      bruto.includes(Buffer.from(chave!.toString('hex'))),
      false,
      'a chave do servidor vazou em hex no banco',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reabrir o banco com a mesma identidade recupera tudo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'concord-vault-'));
  const caminho = join(dir, 'teste.db');

  try {
    const joao = novaIdentidade('joao');

    const primeiro = new ConcordStore(caminho, joao);
    const serverId = primeiro.createServer('Squad');
    const canal = primeiro.createChannel(serverId, 'geral');
    primeiro.sendMessage(serverId, canal, 'primeira mensagem');
    const chaveOriginal = primeiro.serverKey(serverId)!.toString('hex');
    primeiro.close();

    // Simula reabrir o app: mesma identidade, mesmo arquivo.
    const segundo = new ConcordStore(caminho, joao);
    assert.equal(segundo.listMessages(canal)[0].content, 'primeira mensagem');
    assert.equal(segundo.serverKey(serverId)!.toString('hex'), chaveOriginal);
    segundo.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a migracao gera chave so para servidores proprios', () => {
  const dir = mkdtempSync(join(tmpdir(), 'concord-vault-'));
  const caminho = join(dir, 'teste.db');

  try {
    const joao = novaIdentidade('joao');
    const store = new ConcordStore(caminho, joao);
    const serverId = store.createServer('Squad');

    // Simula o estado de um servidor criado antes da cifragem por servidor.
    store.db.prepare('DELETE FROM server_keys WHERE server_id = ?').run(serverId);
    assert.equal(store.serverKey(serverId), null);
    assert.equal(store.serversWithoutKey().length, 1);

    const { migrados, semChave } = store.migrateServerKeys();
    assert.deepEqual(migrados, [serverId]);
    assert.equal(semChave.length, 0);
    assert.ok(store.serverKey(serverId), 'a chave deveria ter sido gerada');
    assert.equal(store.serversWithoutKey().length, 0);

    // E o convite volta a funcionar.
    assert.ok(store.createInvite(serverId).length > 0);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
