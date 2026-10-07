import assert from 'node:assert/strict';
import test from 'node:test';
import { Permission } from '@concord/types';
import { generateRecoveryPhrase, identityFromPhrase } from '../identity/keystore';
import { toHex } from '../identity/keypair';
import { ConcordStore } from '../store';
import { canonicalize } from './canonical';
import { createOperation, sortOperations, verifyOperation } from './sign';
import { Operation } from './types';

function novaIdentidade(nome: string) {
  return identityFromPhrase(generateRecoveryPhrase(), nome);
}

function novoStore(identity: ReturnType<typeof novaIdentidade>) {
  return new ConcordStore(':memory:', identity);
}

/** Snapshot do estado observavel, para comparar peers. */
function snapshot(store: ConcordStore, serverId: string) {
  return {
    servers: store.listServers(),
    members: store.listMembers(serverId),
    channels: store.listChannels(serverId),
    mensagensPorCanal: store
      .listChannels(serverId)
      .map((c) => store.listMessages(c.id).map((m) => `${m.authorKey.slice(0, 6)}:${m.content}`)),
  };
}

// ---------- serializacao canonica ----------

test('canonicalize independe da ordem de insercao das chaves', () => {
  assert.equal(canonicalize({ b: 1, a: 2 }), canonicalize({ a: 2, b: 1 }));
  assert.equal(canonicalize({ x: { z: 1, y: 2 } }), canonicalize({ x: { y: 2, z: 1 } }));
});

test('canonicalize preserva ordem de array', () => {
  assert.notEqual(canonicalize([1, 2]), canonicalize([2, 1]));
});

// ---------- assinatura ----------

test('operacao assinada verifica; adulterada nao', () => {
  const joao = novaIdentidade('joao');
  const op = createOperation(
    {
      type: 'message.create',
      authorKey: toHex(joao.publicKey),
      serverId: 's1',
      seq: 0,
      lamport: 1,
      timestamp: 1000,
      payload: { messageId: 'm1', channelId: 'c1', content: 'bora ranked?', replyToId: null },
    },
    joao.privateKey,
  );

  assert.ok(verifyOperation(op));

  const adulterada: Operation = {
    ...op,
    payload: { messageId: 'm1', channelId: 'c1', content: 'bora perder?', replyToId: null },
  };
  assert.equal(verifyOperation(adulterada), false);
});

test('nao da para forjar operacao em nome de outro', () => {
  const joao = novaIdentidade('joao');
  const pedro = novaIdentidade('pedro');

  // Pedro assina, mas declara a chave do Joao como autor.
  const forjada = createOperation(
    {
      type: 'message.create',
      authorKey: toHex(joao.publicKey),
      serverId: 's1',
      seq: 0,
      lamport: 1,
      timestamp: 1000,
      payload: { messageId: 'm1', channelId: 'c1', content: 'eu sou o joao', replyToId: null },
    },
    pedro.privateKey,
  );

  assert.equal(verifyOperation(forjada), false);
});

// ---------- ordem total ----------

test('a ordenacao e deterministica independente da ordem de entrada', () => {
  const joao = novaIdentidade('joao');
  const base = {
    type: 'message.create' as const,
    authorKey: toHex(joao.publicKey),
    serverId: 's1',
    timestamp: 1000,
  };
  const ops = [1, 2, 3, 4, 5].map((n) =>
    createOperation(
      {
        ...base,
        seq: n,
        lamport: n,
        payload: { messageId: `m${n}`, channelId: 'c1', content: `msg ${n}`, replyToId: null },
      },
      joao.privateKey,
    ),
  );

  const embaralhado = [ops[3], ops[0], ops[4], ops[1], ops[2]];
  assert.deepEqual(
    sortOperations(embaralhado).map((o) => o.id),
    sortOperations(ops).map((o) => o.id),
  );
});

// ---------- permissoes verificadas de verdade ----------

test('quem nao e membro nao consegue mandar mensagem', () => {
  const joao = novaIdentidade('joao');
  const invasor = novaIdentidade('invasor');

  const store = novoStore(joao);
  const serverId = store.createServer('Squad');
  const channelId = store.createChannel(serverId, 'geral');

  // O invasor assina uma mensagem valida para um servidor que nao e dele.
  const op = createOperation(
    {
      type: 'message.create',
      authorKey: toHex(invasor.publicKey),
      serverId,
      seq: 0,
      lamport: 99,
      timestamp: Date.now(),
      payload: { messageId: 'x', channelId, content: 'invadi', replyToId: null },
    },
    invasor.privateKey,
  );

  // A assinatura e legitima - o que barra e a permissao.
  assert.ok(verifyOperation(op));
  store.applyRemoteOperations([op]);
  assert.equal(store.listMessages(channelId).length, 0);
  store.close();
});

test('membro comum nao consegue criar canal', () => {
  const joao = novaIdentidade('joao');
  const pedro = novaIdentidade('pedro');

  const store = novoStore(joao);
  const serverId = store.createServer('Squad');
  store.addMember(serverId, toHex(pedro.publicKey), 'pedro');

  const op = createOperation(
    {
      type: 'channel.create',
      authorKey: toHex(pedro.publicKey),
      serverId,
      seq: 0,
      lamport: 99,
      timestamp: Date.now(),
      payload: {
        channelId: 'c-pirata',
        name: 'pirata',
        type: 'TEXT',
        categoryId: null,
        position: 0,
      },
    },
    pedro.privateKey,
  );

  store.applyRemoteOperations([op]);
  assert.equal(
    store.listChannels(serverId).find((c) => c.name === 'pirata'),
    undefined,
  );
  store.close();
});

test('so o autor edita a propria mensagem', () => {
  const joao = novaIdentidade('joao');
  const pedro = novaIdentidade('pedro');

  const store = novoStore(joao);
  const serverId = store.createServer('Squad');
  const channelId = store.createChannel(serverId, 'geral');
  store.addMember(serverId, toHex(pedro.publicKey), 'pedro');
  const messageId = store.sendMessage(serverId, channelId, 'texto do joao');

  const op = createOperation(
    {
      type: 'message.edit',
      authorKey: toHex(pedro.publicKey),
      serverId,
      seq: 1,
      lamport: 99,
      timestamp: Date.now(),
      payload: { messageId, content: 'pedro reescreveu' },
    },
    pedro.privateKey,
  );

  store.applyRemoteOperations([op]);
  assert.equal(store.listMessages(channelId)[0].content, 'texto do joao');
  store.close();
});

test('mensagem com reply_to_id guarda referencia ao id original', () => {
  const joao = novaIdentidade('joao');
  const store = novoStore(joao);
  const serverId = store.createServer('Gamer Den');
  const channelId = store.createChannel(serverId, 'geral');

  const id1 = store.sendMessage(serverId, channelId, 'primeira msg');
  const id2 = store.sendMessage(serverId, channelId, 'respondendo primeira', id1);

  const msgs = store.listMessages(channelId);
  const resposta = msgs.find((m) => m.id === id2);
  assert.ok(resposta);
  assert.equal(resposta?.replyToId, id1);
  assert.equal(resposta?.content, 'respondendo primeira');
  store.close();
});

test('ninguem se auto-adiciona a um servidor alheio', () => {
  const joao = novaIdentidade('joao');
  const invasor = novaIdentidade('invasor');

  const store = novoStore(joao);
  const serverId = store.createServer('Squad');

  const op = createOperation(
    {
      type: 'member.join',
      authorKey: toHex(invasor.publicKey),
      serverId,
      seq: 0,
      lamport: 99,
      timestamp: Date.now(),
      payload: {
        userKey: toHex(invasor.publicKey),
        displayName: 'invasor',
        inviteCode: null,
      },
    },
    invasor.privateKey,
  );

  store.applyRemoteOperations([op]);
  assert.equal(store.listMembers(serverId).length, 1);
  store.close();
});

test('o dono nao pode ser rebaixado por um admin', () => {
  const joao = novaIdentidade('joao');
  const pedro = novaIdentidade('pedro');
  const joaoKey = toHex(joao.publicKey);
  const pedroKey = toHex(pedro.publicKey);

  const store = novoStore(joao);
  const serverId = store.createServer('Squad');
  store.addMember(serverId, pedroKey, 'pedro');
  // Joao promove Pedro a administrador.
  const promo = createOperation(
    {
      type: 'member.role',
      authorKey: joaoKey,
      serverId,
      seq: 90,
      lamport: 90,
      timestamp: Date.now(),
      payload: { userKey: pedroKey, permissions: String(Permission.ADMINISTRATOR) },
    },
    joao.privateKey,
  );
  store.applyRemoteOperations([promo]);

  // Pedro, agora admin, tenta rebaixar o dono.
  const golpe = createOperation(
    {
      type: 'member.role',
      authorKey: pedroKey,
      serverId,
      seq: 91,
      lamport: 91,
      timestamp: Date.now(),
      payload: { userKey: joaoKey, permissions: '0' },
    },
    pedro.privateKey,
  );
  store.applyRemoteOperations([golpe]);

  const dono = store.listMembers(serverId).find((m) => m.userKey === joaoKey);
  assert.equal(dono?.permissions, String(Permission.ADMINISTRATOR));
  store.close();
});

// ---------- convergencia: o teste central da arquitetura ----------

test('dois peers convergem para o mesmo estado com ordens de chegada diferentes', () => {
  const joao = novaIdentidade('joao');
  const pedro = novaIdentidade('pedro');
  const joaoKey = toHex(joao.publicKey);
  const pedroKey = toHex(pedro.publicKey);

  // Joao monta o servidor e adiciona o Pedro.
  const storeJoao = novoStore(joao);
  const serverId = storeJoao.createServer('Squad');
  const canalGeral = storeJoao.createChannel(serverId, 'geral');
  storeJoao.addMember(serverId, pedroKey, 'pedro');
  storeJoao.sendMessage(serverId, canalGeral, 'bora ranked?');

  // Pedro entra do zero e recebe tudo.
  const storePedro = novoStore(pedro);
  storePedro.applyRemoteOperations(storeJoao.operationsFor(serverId));
  assert.equal(storePedro.listMessages(canalGeral).length, 1);

  // Ambos escrevem "offline", sem se ver.
  storeJoao.sendMessage(serverId, canalGeral, 'to no lobby');
  storePedro.sendMessage(serverId, canalGeral, 'ja to entrando');
  storeJoao.sendMessage(serverId, canalGeral, 'entra ai');

  const opsJoao = storeJoao.operationsFor(serverId);
  const opsPedro = storePedro.operationsFor(serverId);

  // Sincronizam - cada um recebe os ops do outro em ordem embaralhada.
  storeJoao.applyRemoteOperations([...opsPedro].reverse());
  storePedro.applyRemoteOperations([...opsJoao].sort(() => Math.random() - 0.5));

  const estadoJoao = snapshot(storeJoao, serverId);
  const estadoPedro = snapshot(storePedro, serverId);

  assert.deepEqual(estadoPedro, estadoJoao, 'os dois peers divergiram');
  assert.equal(estadoJoao.mensagensPorCanal[0].length, 4);
  assert.equal(estadoJoao.members.length, 2);
  assert.equal(estadoJoao.members.find((m) => m.userKey === joaoKey)?.displayName, 'joao');

  storeJoao.close();
  storePedro.close();
});

test('reaplicar as mesmas operacoes e idempotente', () => {
  const joao = novaIdentidade('joao');
  const store = novoStore(joao);
  const serverId = store.createServer('Squad');
  const channelId = store.createChannel(serverId, 'geral');
  store.sendMessage(serverId, channelId, 'oi');

  const ops = store.operationsFor(serverId);
  const antes = snapshot(store, serverId);

  for (let i = 0; i < 3; i++) store.applyRemoteOperations(ops);

  assert.deepEqual(snapshot(store, serverId), antes);
  store.close();
});

test('peer que volta de offline recebe o historico que perdeu', () => {
  const joao = novaIdentidade('joao');
  const pedro = novaIdentidade('pedro');

  const storeJoao = novoStore(joao);
  const serverId = storeJoao.createServer('Squad');
  const canal = storeJoao.createChannel(serverId, 'geral');
  storeJoao.addMember(serverId, toHex(pedro.publicKey), 'pedro');

  const storePedro = novoStore(pedro);
  storePedro.applyRemoteOperations(storeJoao.operationsFor(serverId));

  // Pedro fica offline; Joao conversa sozinho.
  for (let i = 0; i < 20; i++) storeJoao.sendMessage(serverId, canal, `mensagem ${i}`);
  assert.equal(storePedro.listMessages(canal, 100).length, 0);

  // Pedro volta e sincroniza.
  storePedro.applyRemoteOperations(storeJoao.operationsFor(serverId));

  const doPedro = storePedro.listMessages(canal, 100).map((m) => m.content);
  const doJoao = storeJoao.listMessages(canal, 100).map((m) => m.content);
  assert.equal(doPedro.length, 20);
  assert.deepEqual(doPedro, doJoao, 'historico recuperado fora de ordem');

  storeJoao.close();
  storePedro.close();
});
