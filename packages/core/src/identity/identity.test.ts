import assert from 'node:assert/strict';
import test from 'node:test';
import { formatHandle, sign, toHex, verify } from './keypair';
import {
  decryptKeystore,
  encryptKeystore,
  generateRecoveryPhrase,
  identityFromPhrase,
  isValidRecoveryPhrase,
} from './keystore';

test('a frase gerada tem 12 palavras e e valida', () => {
  const phrase = generateRecoveryPhrase();
  assert.equal(phrase.split(' ').length, 12);
  assert.ok(isValidRecoveryPhrase(phrase));
});

test('a mesma frase sempre gera a mesma identidade', () => {
  const phrase = generateRecoveryPhrase();
  const a = identityFromPhrase(phrase, 'joao');
  const b = identityFromPhrase(phrase, 'joao');
  assert.equal(toHex(a.publicKey), toHex(b.publicKey));
});

test('frases diferentes geram identidades diferentes', () => {
  const a = identityFromPhrase(generateRecoveryPhrase(), 'joao');
  const b = identityFromPhrase(generateRecoveryPhrase(), 'joao');
  assert.notEqual(toHex(a.publicKey), toHex(b.publicKey));
});

test('frase invalida e rejeitada', () => {
  assert.equal(isValidRecoveryPhrase('bora ranked com os amigos hoje a noite pessoal beleza'), false);
  assert.throws(() => identityFromPhrase('frase totalmente invalida aqui', 'joao'));
});

test('assinatura verifica com a chave publica correta e falha com outra', () => {
  const alice = identityFromPhrase(generateRecoveryPhrase(), 'alice');
  const bob = identityFromPhrase(generateRecoveryPhrase(), 'bob');
  const msg = new TextEncoder().encode('bora ranked?');

  const sig = sign(msg, alice.privateKey);
  assert.ok(verify(sig, msg, alice.publicKey));
  assert.equal(verify(sig, msg, bob.publicKey), false);
});

test('mensagem adulterada invalida a assinatura', () => {
  const alice = identityFromPhrase(generateRecoveryPhrase(), 'alice');
  const sig = sign(new TextEncoder().encode('bora ranked?'), alice.privateKey);
  const adulterada = new TextEncoder().encode('bora ranked!');
  assert.equal(verify(sig, adulterada, alice.publicKey), false);
});

test('keystore faz round-trip com a senha correta', () => {
  const phrase = generateRecoveryPhrase();
  const store = encryptKeystore(phrase, 'senha-forte-123', 'joao');
  const restored = decryptKeystore(store, 'senha-forte-123');

  assert.equal(restored.displayName, 'joao');
  assert.equal(toHex(restored.publicKey), store.publicKey);
  assert.equal(toHex(restored.publicKey), toHex(identityFromPhrase(phrase, 'joao').publicKey));
});

test('senha errada e rejeitada em vez de devolver lixo', () => {
  const store = encryptKeystore(generateRecoveryPhrase(), 'senha-certa', 'joao');
  assert.throws(() => decryptKeystore(store, 'senha-errada'), /Senha incorreta/);
});

test('a frase nunca aparece em texto claro no keystore', () => {
  const phrase = generateRecoveryPhrase();
  const store = encryptKeystore(phrase, 'senha-forte-123', 'joao');

  // Nao da para procurar palavra a palavra: varias palavras BIP39 sao formadas
  // so por caracteres hex ("add", "face", "decade", "beef") e aparecem por
  // acaso no ciphertext hexadecimal. O que importa e que a frase completa e os
  // bytes dela nao estejam la.
  assert.equal(JSON.stringify(store).includes(phrase), false, 'a frase completa vazou');

  const phraseBytes = Buffer.from(phrase, 'utf8');
  const cipherBytes = Buffer.from(store.ciphertext, 'hex');
  assert.equal(cipherBytes.includes(phraseBytes), false, 'os bytes da frase vazaram');
  assert.equal(cipherBytes.length, phraseBytes.length, 'AES-GCM e stream: mesmo tamanho');
});

test('recuperar a conta em outra maquina so com a frase', () => {
  // Simula: usuario perdeu o PC e reinstala do zero, digitando so a frase.
  const phrase = generateRecoveryPhrase();
  const original = identityFromPhrase(phrase, 'joao');

  const novaMaquina = encryptKeystore(phrase, 'outra-senha-diferente', 'joao');
  const recuperada = decryptKeystore(novaMaquina, 'outra-senha-diferente');

  assert.equal(toHex(recuperada.publicKey), toHex(original.publicKey));
  assert.equal(formatHandle('joao', recuperada.publicKey), formatHandle('joao', original.publicKey));
});

test('o handle tem o formato nome#fingerprint', () => {
  const id = identityFromPhrase(generateRecoveryPhrase(), 'joao');
  assert.match(formatHandle('joao', id.publicKey), /^joao#[0-9a-f]{4}$/);
});
