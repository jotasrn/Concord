import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KEYSTORE_FILE, deviceDir, devicesRoot, isValidDeviceToken, sweepDataDir } from './devices';

const TOKEN = 'a'.repeat(64);

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'concord-devices-'));
}

test('deviceDir e deterministico e nao contem o token', () => {
  const d = tmp();
  try {
    const a = deviceDir(d, TOKEN);
    assert.equal(a, deviceDir(d, TOKEN));
    assert.ok(!a.includes(TOKEN));
    assert.notEqual(a, deviceDir(d, 'b'.repeat(64)));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('deviceDir recusa token fora do formato (inclusive path traversal)', () => {
  assert.throws(() => deviceDir('/x', '../../etc'), /invalido/);
  assert.throws(() => deviceDir('/x', 'A'.repeat(64)), /invalido/);
  assert.equal(isValidDeviceToken(null), false);
  assert.equal(isValidDeviceToken(TOKEN), true);
});

test('sweepDataDir remove pastas sem conta e preserva as com conta', () => {
  const d = tmp();
  try {
    const legadaVazia = join(d, '11111111-2222-3333-4444-555555555555');
    const legadaComConta = join(d, '66666666-7777-8888-9999-000000000000');
    const naoMexer = join(d, 'outra-coisa');
    mkdirSync(legadaVazia);
    mkdirSync(legadaComConta);
    mkdirSync(naoMexer);
    writeFileSync(join(legadaComConta, KEYSTORE_FILE), '{}');

    const vazio = deviceDir(d, TOKEN);
    const comConta = deviceDir(d, 'c'.repeat(64));
    const ativo = deviceDir(d, 'd'.repeat(64));
    for (const p of [vazio, comConta, ativo]) mkdirSync(p, { recursive: true });
    writeFileSync(join(comConta, KEYSTORE_FILE), '{}');

    const r = sweepDataDir(d, new Set([ativo]));
    assert.deepEqual(r, { removidas: 2, legadasComConta: 1 });
    assert.equal(existsSync(legadaVazia), false);
    assert.equal(existsSync(vazio), false);
    assert.equal(existsSync(legadaComConta), true);
    assert.equal(existsSync(comConta), true);
    assert.equal(existsSync(ativo), true, 'pasta em uso nao pode ser apagada');
    assert.equal(existsSync(naoMexer), true);
    assert.equal(existsSync(devicesRoot(d)), true);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('sweepDataDir tolera pasta inexistente', () => {
  assert.deepEqual(sweepDataDir(join(tmpdir(), 'nao-existe-concord')), {
    removidas: 0,
    legadasComConta: 0,
  });
});
