import assert from 'node:assert/strict';
import test from 'node:test';
import { generateRecoveryPhrase, identityFromPhrase } from '../identity/keystore';
import { toHex } from '../identity/keypair';
import { ConcordStore } from '../store';
import { createOperation } from './sign';
import { OpPayload, OpType } from './types';

/**
 * Testes com um peer hostil. Tudo aqui e assinado corretamente: o atacante
 * tem uma identidade valida e e membro do servidor. O que se verifica e se o
 * reducer aguenta payloads deformados sem derrubar o processo.
 */
function cenario() {
  const dono = identityFromPhrase(generateRecoveryPhrase(), 'dono');
  const hostil = identityFromPhrase(generateRecoveryPhrase(), 'hostil');
  const store = new ConcordStore(':memory:', dono);
  const serverId = store.createServer('Squad');
  const channelId = store.createChannel(serverId, 'geral');
  store.addMember(serverId, toHex(hostil.publicKey), 'hostil');
  return { dono, hostil, store, serverId, channelId };
}

function opHostil(
  hostil: ReturnType<typeof identityFromPhrase>,
  serverId: string,
  type: OpType,
  payload: unknown,
  seq = 0,
) {
  return createOperation(
    {
      type,
      authorKey: toHex(hostil.publicKey),
      serverId,
      seq,
      lamport: 500 + seq,
      timestamp: Date.now(),
      payload: payload as OpPayload,
    },
    hostil.privateKey,
  );
}

test('payload nulo nao derruba o reducer', () => {
  const { hostil, store, serverId } = cenario();
  assert.doesNotThrow(() =>
    store.applyRemoteOperations([opHostil(hostil, serverId, 'message.create', null)]),
  );
  store.close();
});

test('payload sem os campos esperados nao derruba o reducer', () => {
  const { hostil, store, serverId } = cenario();
  assert.doesNotThrow(() =>
    store.applyRemoteOperations([opHostil(hostil, serverId, 'message.create', {})]),
  );
  store.close();
});

test('campos com tipo errado nao derrubam o reducer', () => {
  const { hostil, store, serverId, channelId } = cenario();
  assert.doesNotThrow(() =>
    store.applyRemoteOperations([
      opHostil(hostil, serverId, 'message.create', {
        messageId: { objeto: 'em vez de string' },
        channelId,
        content: 12345,
        replyToId: [],
      }),
    ]),
  );
  store.close();
});

test('permissions nao numerico em member.role nao derruba o reducer', () => {
  const { hostil, store, serverId } = cenario();
  assert.doesNotThrow(() =>
    store.applyRemoteOperations([
      opHostil(hostil, serverId, 'member.role', {
        userKey: toHex(hostil.publicKey),
        permissions: 'nao-e-numero',
      }),
    ]),
  );
  store.close();
});

test('mensagem gigante de um peer e rejeitada', () => {
  const { hostil, store, serverId, channelId } = cenario();
  const gigante = 'x'.repeat(2_000_000);

  store.applyRemoteOperations([
    opHostil(hostil, serverId, 'message.create', {
      messageId: 'grande',
      channelId,
      content: gigante,
      replyToId: null,
    }),
  ]);

  const guardada = store.listMessages(channelId, 50).find((m) => m.id === 'grande');
  assert.equal(guardada, undefined, 'mensagem acima do limite foi persistida');
  store.close();
});

test('uma operacao invalida nao impede as validas do mesmo lote', () => {
  const { hostil, store, serverId, channelId } = cenario();

  store.applyRemoteOperations([
    opHostil(hostil, serverId, 'message.create', null, 0),
    opHostil(
      hostil,
      serverId,
      'message.create',
      { messageId: 'boa', channelId, content: 'mensagem legitima', replyToId: null },
      1,
    ),
  ]);

  const conteudos = store.listMessages(channelId, 50).map((m) => m.content);
  assert.ok(conteudos.includes('mensagem legitima'), 'a operacao valida foi perdida');
  store.close();
});
