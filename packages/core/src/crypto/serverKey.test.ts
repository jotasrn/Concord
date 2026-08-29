import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeInvite,
  encodeInvite,
  generateServerKey,
  open,
  seal,
  topicFromServerKey,
} from './serverKey';

test('chaves geradas sao distintas e tem 32 bytes', () => {
  const a = generateServerKey();
  const b = generateServerKey();
  assert.equal(a.length, 32);
  assert.notEqual(a.toString('hex'), b.toString('hex'));
});

test('o topico e estavel para a mesma chave e diferente entre chaves', () => {
  const key = generateServerKey();
  assert.equal(topicFromServerKey(key).toString('hex'), topicFromServerKey(key).toString('hex'));
  assert.notEqual(
    topicFromServerKey(key).toString('hex'),
    topicFromServerKey(generateServerKey()).toString('hex'),
  );
});

test('o topico nao revela a chave', () => {
  const key = generateServerKey();
  const topico = topicFromServerKey(key).toString('hex');
  assert.notEqual(topico, key.toString('hex'));
  assert.equal(topico.includes(key.toString('hex')), false);
});

test('seal/open faz round-trip com a chave certa', () => {
  const key = generateServerKey();
  const texto = JSON.stringify([{ conteudo: 'bora ranked?' }]);
  assert.equal(open(key, seal(key, texto)), texto);
});

test('chave errada nao decifra', () => {
  const texto = 'segredo do squad';
  assert.equal(open(generateServerKey(), seal(generateServerKey(), texto)), null);
});

test('texto cifrado adulterado e rejeitado pelo GCM', () => {
  const key = generateServerKey();
  const sealed = seal(key, 'mensagem original');

  const bytes = Buffer.from(sealed.c, 'base64');
  bytes[0] ^= 0xff;
  assert.equal(open(key, { ...sealed, c: bytes.toString('base64') }), null);
});

test('tag de autenticacao trocada e rejeitada', () => {
  const key = generateServerKey();
  const a = seal(key, 'mensagem A');
  const b = seal(key, 'mensagem B');
  assert.equal(open(key, { ...a, t: b.t }), null);
});

test('o mesmo texto cifra diferente a cada vez (nonce aleatorio)', () => {
  const key = generateServerKey();
  assert.notEqual(seal(key, 'igual').c, seal(key, 'igual').c);
});

test('o conteudo nao aparece em claro no payload cifrado', () => {
  const key = generateServerKey();
  const segredo = 'senha-do-wifi-do-squad';
  const sealed = seal(key, segredo);
  assert.equal(JSON.stringify(sealed).includes(segredo), false);
  assert.equal(Buffer.from(sealed.c, 'base64').includes(Buffer.from(segredo)), false);
});

test('convite faz round-trip', () => {
  const key = generateServerKey();
  const codigo = encodeInvite('servidor-123', key);
  const decodificado = decodeInvite(codigo);

  assert.equal(decodificado?.serverId, 'servidor-123');
  assert.equal(decodificado?.serverKey.toString('hex'), key.toString('hex'));
});

test('convites malformados sao rejeitados sem lancar excecao', () => {
  for (const ruim of ['', 'lixo', 'YWJj', '!!!!', 'a'.repeat(5000)]) {
    assert.doesNotThrow(() => decodeInvite(ruim));
    assert.equal(decodeInvite(ruim), null);
  }
});

test('convite sem chave hexadecimal valida e rejeitado', () => {
  const ruim = Buffer.from('servidor-123.naoehex', 'utf8').toString('base64url');
  assert.equal(decodeInvite(ruim), null);
});
