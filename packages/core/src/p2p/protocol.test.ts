import assert from 'node:assert/strict';
import test from 'node:test';
import { generateRecoveryPhrase, identityFromPhrase } from '../identity/keystore';
import { toHex } from '../identity/keypair';
import { ConcordStore } from '../store';
import { FrameDecoder, computeHeads, encodeFrame, operationsMissingFor } from './protocol';

test('heads registram o maior seq de cada autor', () => {
  const joao = identityFromPhrase(generateRecoveryPhrase(), 'joao');
  const store = new ConcordStore(':memory:', joao);
  const serverId = store.createServer('Squad');
  store.createChannel(serverId, 'geral');

  const heads = computeHeads(store.operationsFor(serverId));
  assert.equal(heads[toHex(joao.publicKey)], 1);
  store.close();
});

test('operationsMissingFor manda o log inteiro para quem nao conhece o autor', () => {
  const joao = identityFromPhrase(generateRecoveryPhrase(), 'joao');
  const store = new ConcordStore(':memory:', joao);
  const serverId = store.createServer('Squad');
  const canal = store.createChannel(serverId, 'geral');
  store.sendMessage(serverId, canal, 'oi');

  const ops = store.operationsFor(serverId);
  assert.equal(operationsMissingFor(ops, {}).length, ops.length);
  assert.equal(operationsMissingFor(ops, computeHeads(ops)).length, 0);
  store.close();
});

test('operationsMissingFor manda so o delta', () => {
  const joao = identityFromPhrase(generateRecoveryPhrase(), 'joao');
  const store = new ConcordStore(':memory:', joao);
  const serverId = store.createServer('Squad');
  const canal = store.createChannel(serverId, 'geral');

  const heads = computeHeads(store.operationsFor(serverId));
  store.sendMessage(serverId, canal, 'nova 1');
  store.sendMessage(serverId, canal, 'nova 2');

  const faltando = operationsMissingFor(store.operationsFor(serverId), heads);
  assert.equal(faltando.length, 2);
  store.close();
});

test('o decoder remonta mensagens quebradas entre chunks TCP', () => {
  const decoder = new FrameDecoder();
  const frame = encodeFrame({ t: 'hello', servers: ['a', 'b'], me: 'chave-do-peer' });

  // Simula o stream cortando o frame no meio.
  const meio = Math.floor(frame.length / 2);
  assert.deepEqual(decoder.push(frame.subarray(0, meio)), []);

  const mensagens = decoder.push(frame.subarray(meio));
  assert.equal(mensagens.length, 1);
  assert.deepEqual(mensagens[0], { t: 'hello', servers: ['a', 'b'], me: 'chave-do-peer' });
});

test('o decoder separa varias mensagens que chegam juntas', () => {
  const decoder = new FrameDecoder();
  const juntas = Buffer.concat([
    encodeFrame({ t: 'hello', servers: ['a'], me: 'chave-do-peer' }),
    encodeFrame({ t: 'have', serverId: 'a', heads: { k: 3 } }),
  ]);
  assert.equal(decoder.push(juntas).length, 2);
});

test('linha corrompida nao derruba o decoder', () => {
  const decoder = new FrameDecoder();
  const chunk = Buffer.concat([
    Buffer.from('{lixo nao json}\n'),
    encodeFrame({ t: 'hello', servers: ['a'], me: 'chave-do-peer' }),
  ]);
  const mensagens = decoder.push(chunk);
  assert.equal(mensagens.length, 1);
  assert.equal(mensagens[0].t, 'hello');
});

test('ciclo completo de sync reproduz o estado no outro peer', () => {
  const joao = identityFromPhrase(generateRecoveryPhrase(), 'joao');
  const pedro = identityFromPhrase(generateRecoveryPhrase(), 'pedro');

  const a = new ConcordStore(':memory:', joao);
  const serverId = a.createServer('Squad');
  const canal = a.createChannel(serverId, 'geral');
  a.addMember(serverId, toHex(pedro.publicKey), 'pedro');
  a.sendMessage(serverId, canal, 'bora ranked?');

  const b = new ConcordStore(':memory:', pedro);

  // B anuncia que nao tem nada; A calcula o delta e envia.
  const delta = operationsMissingFor(a.operationsFor(serverId), computeHeads(b.operationsFor(serverId)));
  b.applyRemoteOperations(delta);

  assert.deepEqual(
    b.listMessages(canal).map((m) => m.content),
    ['bora ranked?'],
  );
  assert.equal(b.listChannels(serverId).length, 1);
  assert.equal(b.listMembers(serverId).length, 2);

  // Nada novo para trocar na segunda rodada.
  assert.equal(
    operationsMissingFor(a.operationsFor(serverId), computeHeads(b.operationsFor(serverId))).length,
    0,
  );

  a.close();
  b.close();
});
