import assert from 'node:assert/strict';
import test from 'node:test';
import { Permission } from '@concord/types';
import { generateRecoveryPhrase, identityFromPhrase } from '../identity/keystore';
import { toHex } from '../identity/keypair';
import { ConcordStore } from '../store';
import { ROLE_PRESETS, describeRole } from '../roles';
import { createOperation } from './sign';
import { OpPayload, OpType } from './types';

function novaIdentidade(nome: string) {
  return identityFromPhrase(generateRecoveryPhrase(), nome);
}

/** Dono, um moderador e um membro comum num servidor pronto. */
function cenario() {
  const dono = novaIdentidade('dono');
  const moderador = novaIdentidade('moderador');
  const membro = novaIdentidade('membro');

  const store = new ConcordStore(':memory:', dono);
  const serverId = store.createServer('Squad');

  const modKey = toHex(moderador.publicKey);
  const membroKey = toHex(membro.publicKey);
  store.addMember(serverId, modKey, 'moderador');
  store.addMember(serverId, membroKey, 'membro');

  const preset = ROLE_PRESETS.find((r) => r.id === 'moderador')!;
  store.setRole(serverId, modKey, preset.permissions, preset.label);

  return { store, serverId, dono, moderador, membro, modKey, membroKey };
}

/** Cria uma operacao assinada por outro peer, como chegaria pela rede. */
function opDe(
  identity: ReturnType<typeof novaIdentidade>,
  serverId: string,
  type: OpType,
  payload: OpPayload,
  seq = 90,
) {
  return createOperation(
    {
      type,
      authorKey: toHex(identity.publicKey),
      serverId,
      seq,
      lamport: 500 + seq,
      timestamp: Date.now(),
      payload,
    },
    identity.privateKey,
  );
}

// ---------- cargos ----------

test('preset de moderador concede expulsar e gerenciar, mas nao administrador', () => {
  const preset = ROLE_PRESETS.find((r) => r.id === 'moderador')!;
  const bits = preset.permissions;

  assert.ok(bits & BigInt(Permission.KICK_MEMBERS));
  assert.ok(bits & BigInt(Permission.MANAGE_MEMBERS));
  assert.equal(bits & BigInt(Permission.ADMINISTRATOR), BigInt(0));
});

test('describeRole nomeia o bitmask', () => {
  assert.equal(describeRole(String(Permission.ADMINISTRATOR)), 'Administrador');
  const membro = ROLE_PRESETS.find((r) => r.id === 'membro')!;
  assert.equal(describeRole(membro.permissions.toString()), 'Membro');
});

test('o cargo aplicado aparece na lista de membros', () => {
  const { store, serverId, modKey } = cenario();
  const mod = store.listMembers(serverId).find((m) => m.userKey === modKey);
  assert.equal(mod?.roleName, 'Moderador');
});

// ---------- apelido ----------

test('apelido tem prioridade sobre o nome do perfil', () => {
  const { store, serverId, membroKey } = cenario();

  store.setNickname(serverId, membroKey, 'Zezinho');
  const m = store.listMembers(serverId).find((x) => x.userKey === membroKey);

  assert.equal(m?.displayName, 'Zezinho');
  assert.equal(m?.nickname, 'Zezinho');
  // O nome original continua acessivel, para a interface poder mostrar os dois.
  assert.equal(m?.profileName, 'membro');
});

test('remover o apelido volta ao nome do perfil', () => {
  const { store, serverId, membroKey } = cenario();

  store.setNickname(serverId, membroKey, 'Zezinho');
  store.setNickname(serverId, membroKey, null);

  const m = store.listMembers(serverId).find((x) => x.userKey === membroKey);
  assert.equal(m?.displayName, 'membro');
  assert.equal(m?.nickname, null);
});

test('membro comum nao muda o apelido dos outros', () => {
  const { store, serverId, membro, modKey } = cenario();

  store.applyRemoteOperations([
    opDe(membro, serverId, 'member.nick', { userKey: modKey, nickname: 'hackeado' }),
  ]);

  const mod = store.listMembers(serverId).find((m) => m.userKey === modKey);
  assert.notEqual(mod?.displayName, 'hackeado');
});

test('mas pode mudar o proprio apelido', () => {
  const { store, serverId, membro, membroKey } = cenario();

  store.applyRemoteOperations([
    opDe(membro, serverId, 'member.nick', { userKey: membroKey, nickname: 'eu mesmo' }),
  ]);

  const m = store.listMembers(serverId).find((x) => x.userKey === membroKey);
  assert.equal(m?.displayName, 'eu mesmo');
});

// ---------- expulsar ----------

test('moderador expulsa membro comum', () => {
  const { store, serverId, moderador, membroKey } = cenario();

  store.applyRemoteOperations([
    opDe(moderador, serverId, 'member.kick', { userKey: membroKey, reason: null }),
  ]);

  assert.equal(
    store.listMembers(serverId).some((m) => m.userKey === membroKey),
    false,
  );
});

test('membro comum nao expulsa ninguem', () => {
  const { store, serverId, membro, modKey } = cenario();

  store.applyRemoteOperations([
    opDe(membro, serverId, 'member.kick', { userKey: modKey, reason: null }),
  ]);

  assert.ok(store.listMembers(serverId).some((m) => m.userKey === modKey));
});

test('o dono nao pode ser expulso nem por um moderador', () => {
  const { store, serverId, moderador, dono } = cenario();
  const donoKey = toHex(dono.publicKey);

  store.applyRemoteOperations([
    opDe(moderador, serverId, 'member.kick', { userKey: donoKey, reason: null }),
  ]);

  assert.ok(store.listMembers(serverId).some((m) => m.userKey === donoKey));
});

test('expulso deixa de conseguir escrever', () => {
  const { store, serverId, membro, membroKey } = cenario();
  const canal = store.createChannel(serverId, 'geral');

  store.kickMember(serverId, membroKey);
  store.applyRemoteOperations([
    opDe(membro, serverId, 'message.create', {
      messageId: 'depois-do-kick',
      channelId: canal,
      content: 'ainda estou aqui',
      replyToId: null,
    }),
  ]);

  assert.equal(store.listMessages(canal).length, 0);
});

// ---------- silenciar ----------

test('moderador silencia membro', () => {
  const { store, serverId, moderador, membroKey } = cenario();

  store.applyRemoteOperations([
    opDe(moderador, serverId, 'member.mute', { userKey: membroKey, muted: true }),
  ]);

  assert.equal(store.listMembers(serverId).find((m) => m.userKey === membroKey)?.muted, true);
});

test('membro comum nao silencia ninguem', () => {
  const { store, serverId, membro, modKey } = cenario();

  store.applyRemoteOperations([
    opDe(membro, serverId, 'member.mute', { userKey: modKey, muted: true }),
  ]);

  assert.equal(store.listMembers(serverId).find((m) => m.userKey === modKey)?.muted, false);
});

test('silenciar-se para escapar nao funciona ao contrario: so quem tem permissao desliga', () => {
  const { store, serverId, membro, membroKey } = cenario();

  store.setMuted(serverId, membroKey, true);
  // O proprio silenciado tenta se liberar.
  store.applyRemoteOperations([
    opDe(membro, serverId, 'member.mute', { userKey: membroKey, muted: false }),
  ]);

  assert.equal(store.listMembers(serverId).find((m) => m.userKey === membroKey)?.muted, true);
});

test('o dono nao pode ser silenciado', () => {
  const { store, serverId, moderador, dono } = cenario();
  const donoKey = toHex(dono.publicKey);

  store.applyRemoteOperations([
    opDe(moderador, serverId, 'member.mute', { userKey: donoKey, muted: true }),
  ]);

  assert.equal(store.listMembers(serverId).find((m) => m.userKey === donoKey)?.muted, false);
});
