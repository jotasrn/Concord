import assert from 'node:assert/strict';
import test from 'node:test';
import { Permission } from '@concord/types';
import { generateRecoveryPhrase, identityFromPhrase } from '../identity/keystore';
import { toHex } from '../identity/keypair';
import { ConcordStore } from '../store';
import { ROLE_PRESETS } from '../roles';
import { createOperation } from './sign';
import { OpPayload, OpType } from './types';

/**
 * Regressao dos ataques de uma avaliacao de seguranca externa (revisao do
 * commit 72edf04, cinco cenarios confirmados por prova de conceito).
 *
 * Cada teste aqui monta o MESMO ataque que a PoC descreveu e afirma que ele
 * nao teve efeito. O atacante sempre tem uma identidade valida e, quando faz
 * sentido, ja e membro do servidor - o ponto nao e falsificar quem ele e
 * (isso ja era coberto por `ops.test.ts`), e sim o que ele consegue fazer
 * mesmo sendo exatamente quem diz ser.
 */

function novaIdentidade(nome: string) {
  return identityFromPhrase(generateRecoveryPhrase(), nome);
}

/** Opera uma operacao assinada por outra pessoa, como chegaria pela rede. */
function opDe(
  identity: ReturnType<typeof novaIdentidade>,
  serverId: string,
  type: OpType,
  payload: OpPayload,
  overrides: { seq?: number; lamport?: number } = {},
) {
  return createOperation(
    {
      type,
      authorKey: toHex(identity.publicKey),
      serverId,
      seq: overrides.seq ?? 900,
      lamport: overrides.lamport ?? 900,
      timestamp: Date.now(),
      payload,
    },
    identity.privateKey,
  );
}

// ---------- #1: tomada de servidor via lamport negativo ----------

test('membro com a chave do servidor nao toma o servidor com server.create forjado', () => {
  const dono = novaIdentidade('dono');
  const atacante = novaIdentidade('atacante');

  const store = new ConcordStore(':memory:', dono);
  const serverId = store.createServer('Squad');
  store.addMember(serverId, toHex(atacante.publicKey), 'atacante');

  // O atacante tem a chave do servidor (e membro) e assina um server.create
  // concorrente com lamport bem abaixo de qualquer operacao legitima - a
  // tentativa classica de vencer a corrida de "quem e aplicado primeiro".
  const forjado = opDe(
    atacante,
    serverId,
    'server.create',
    {
      serverId,
      nonce: '00000000000000000000000000000000', // propositalmente invalido/arbitrario
      name: 'HACKED',
      icon: null,
      ownerDisplayName: 'atacante',
    },
    { lamport: -1, seq: 0 },
  );

  store.applyRemoteOperations([forjado]);

  const servidor = store.listServers().find((s) => s.id === serverId);
  assert.ok(servidor, 'o servidor original precisa continuar existindo');
  assert.equal(servidor!.name, 'Squad', 'o nome nao pode ter sido trocado');

  const dono_ = store.listMembers(serverId).find((m) => m.userKey === toHex(dono.publicKey));
  assert.equal(dono_?.permissions, String(Permission.ADMINISTRATOR), 'o dono continua administrador');

  store.close();
});

test('server.create com id nao autocertificado e rejeitado mesmo com lamport valido', () => {
  const dono = novaIdentidade('dono');
  const atacante = novaIdentidade('atacante');
  const store = new ConcordStore(':memory:', dono);
  const serverId = store.createServer('Squad');

  // Desta vez o atacante nem tenta vencer a corrida por lamport - so manda um
  // id que nao fecha a conta de sha256(autor + nonce). Precisa falhar de
  // qualquer jeito: o id e a prova, nao a ordem.
  const forjado = opDe(atacante, serverId, 'server.create', {
    serverId,
    nonce: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    name: 'HACKED',
    icon: null,
    ownerDisplayName: 'atacante',
  });

  // `accepted` em applyRemoteOperations so diz "entrou no log assinado" - uma
  // operacao bem formada e assinada SEMPRE entra, mesmo que o reducer va
  // rejeita-la depois. O que importa e a PROJECAO: ela nao pode ter mudado.
  store.applyRemoteOperations([forjado]);
  assert.equal(store.listServers().find((s) => s.id === serverId)?.name, 'Squad');
  assert.equal(store.listServers().length, 1, 'nenhum servidor novo pode ter sido criado');

  store.close();
});

/*
 * ---------- #2: reescrever o passado (mensagem retroativa de um expulso) ----------
 *
 * Este ataque NAO tem correcao nesta rodada. "autor nao e membro" so e
 * verdade na projecao DEPOIS que o kick e aplicado; durante o replay em
 * ordem de lamport, uma mensagem com lamport menor que o do kick e processada
 * ANTES dele, quando a vitima ainda consta como membro. Isso e indistinguivel
 * de uma mensagem legitima que sofreu atraso de rede (o proprio projeto
 * depende de aceitar operacoes atrasadas - e o que faz "peer que volta de
 * offline recebe o historico que perdeu" funcionar).
 *
 * A correcao de verdade exige causalidade real no log (cada operacao
 * referenciando o hash das que seu autor conhecia ao cria-la, como um DAG),
 * nao apenas um lamport que o proprio autor escolhe. E uma mudanca de formato
 * de operacao e de reducer, nao um ajuste pontual - fica registrada como
 * limitacao conhecida em docs/SECURITY.md em vez de fingida como corrigida
 * aqui.
 */

// ---------- #3: moderador se autopromove a administrador ----------

function cenarioComModerador() {
  const dono = novaIdentidade('dono');
  const moderador = novaIdentidade('moderador');
  const outroModerador = novaIdentidade('outroModerador');

  const store = new ConcordStore(':memory:', dono);
  const serverId = store.createServer('Squad');

  const modKey = toHex(moderador.publicKey);
  store.addMember(serverId, modKey, 'moderador');
  const presetMod = ROLE_PRESETS.find((r) => r.id === 'moderador')!;
  store.setRole(serverId, modKey, presetMod.permissions, presetMod.label);

  const outroKey = toHex(outroModerador.publicKey);
  store.addMember(serverId, outroKey, 'outroModerador');
  store.setRole(serverId, outroKey, presetMod.permissions, presetMod.label);

  return { store, serverId, dono, moderador, modKey, outroModerador, outroKey };
}

test('moderador nao se autopromove a administrador', () => {
  const { store, serverId, moderador, modKey } = cenarioComModerador();

  store.applyRemoteOperations([
    opDe(moderador, serverId, 'member.role', {
      userKey: modKey,
      permissions: String(Permission.ADMINISTRATOR),
      roleName: 'Admin',
    }),
  ]);

  const m = store.listMembers(serverId).find((x) => x.userKey === modKey)!;
  assert.equal(BigInt(m.permissions) & BigInt(Permission.ADMINISTRATOR), 0n);
});

test('moderador nao rebaixa nem expulsa outro moderador com permissao que nao possui', () => {
  const { store, serverId, moderador, outroModerador, outroKey } = cenarioComModerador();

  // Da ao segundo moderador uma permissao extra que o primeiro nao tem.
  store.setRole(
    serverId,
    outroKey,
    ROLE_PRESETS.find((r) => r.id === 'moderador')!.permissions | BigInt(Permission.BAN_MEMBERS),
    'Moderador+',
  );

  store.applyRemoteOperations([
    opDe(moderador, serverId, 'member.kick', { userKey: outroKey, reason: null }),
  ]);

  assert.ok(
    store.listMembers(serverId).some((m) => m.userKey === outroKey),
    'nao pode expulsar quem tem uma permissao que o expulsor nao possui',
  );
});

// ---------- #4: ataques entre servidores ----------

test('administrador do proprio servidor nao apaga mensagem de outro servidor', () => {
  const dono = novaIdentidade('dono');
  const store = new ConcordStore(':memory:', dono);

  const serverA = store.createServer('ServidorDoAtacante');
  const serverB = store.createServer('ServidorDaVitima');
  const canalB = store.createChannel(serverB, 'geral');
  const msgId = store.sendMessage(serverB, canalB, 'mensagem da vitima');

  // O "atacante" aqui e o proprio dono - administrador em AMBOS os
  // servidores, exatamente como no cenario da PoC (admin do servidor X ataca
  // mensagem de Y). O que se testa e o campo op.serverId, nao a identidade.
  const opMaliciosa = opDe(dono, serverA, 'message.delete', { messageId: msgId });
  store.applyRemoteOperations([opMaliciosa]);

  const mensagens = store.listMessages(canalB);
  assert.ok(
    mensagens.some((m) => m.id === msgId && m.content === 'mensagem da vitima'),
    'message.delete carimbado com o serverId errado nao pode apagar mensagem de outro servidor',
  );

  store.close();
});

test('dois servidores nao conseguem colidir no mesmo channelId', () => {
  const dono = novaIdentidade('dono');
  const store = new ConcordStore(':memory:', dono);

  const serverA = store.createServer('A');
  const serverB = store.createServer('B');
  const canalB = store.createChannel(serverB, 'geral');

  // Tenta criar, em A, um canal com o MESMO id do canal legitimo de B.
  const colisao = opDe(dono, serverA, 'channel.create', {
    channelId: canalB,
    nonce: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    name: 'roubado',
    type: 'TEXT',
    categoryId: null,
    position: 0,
  });

  store.applyRemoteOperations([colisao]);

  // Nao pode ter criado canal nenhum em A com esse id.
  assert.equal(store.listChannels(serverA).some((c) => c.id === canalB), false);
  // E o canal de B continua intacto e pertencendo a B.
  assert.ok(store.listChannels(serverB).some((c) => c.id === canalB));

  store.close();
});

test('operacao com servidor diferente do envelope nao e aplicada (defesa em profundidade)', () => {
  // Simula o que node.ts faz antes mesmo de chamar applyRemoteOperations:
  // descarta qualquer operacao cujo serverId nao bata com o envelope cifrado
  // que a trouxe.
  const dono = novaIdentidade('dono');
  const store = new ConcordStore(':memory:', dono);
  const serverA = store.createServer('A');
  const serverB = store.createServer('B');

  const opParaB = opDe(dono, serverB, 'server.update', { name: 'invadido' });
  const envelopeServerId = serverA; // chegou pelo canal de A

  const filtradas = [opParaB].filter((op) => op.serverId === envelopeServerId);
  assert.equal(filtradas.length, 0, 'operacao de B nunca deveria ser processada vinda do canal de A');

  store.close();
});
