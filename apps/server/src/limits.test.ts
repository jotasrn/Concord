import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConnectionLimiter,
  UnlockGuard,
  WindowRateLimiter,
  clientIp,
  isOriginAllowed,
  loadLimitConfig,
  parseAllowedOrigins,
} from './limits';

test('ConnectionLimiter respeita teto total e por IP', () => {
  const l = new ConnectionLimiter(3, 2);
  assert.equal(l.acquire('a'), null);
  assert.equal(l.acquire('a'), null);
  assert.match(l.acquire('a') ?? '', /endereco/);
  assert.equal(l.acquire('b'), null);
  assert.match(l.acquire('c') ?? '', /cheio/);
  l.release('a');
  assert.equal(l.acquire('c'), null);
  assert.equal(l.active, 3);
});

test('ConnectionLimiter ignora release sem acquire', () => {
  const l = new ConnectionLimiter(1, 1);
  l.release('x');
  assert.equal(l.active, 0);
  assert.equal(l.acquire('x'), null);
});

test('WindowRateLimiter libera de novo apos a janela', () => {
  let agora = 0;
  const r = new WindowRateLimiter(2, 1000, () => agora);
  assert.equal(r.take(), true);
  assert.equal(r.take(), true);
  assert.equal(r.take(), false);
  assert.equal(r.retryAfterSeconds(), 1);
  agora = 1000;
  assert.equal(r.take(), true);
});

test('UnlockGuard trava apos N falhas e destrava depois', () => {
  let agora = 0;
  const g = new UnlockGuard(3, 60_000, () => agora);
  g.fail();
  g.fail();
  g.assertAllowed();
  g.fail();
  assert.throws(() => g.assertAllowed(), /Aguarde 60s/);
  agora = 60_000;
  g.assertAllowed();
});

test('UnlockGuard zera contagem no sucesso', () => {
  const g = new UnlockGuard(2, 1000, () => 0);
  g.fail();
  g.succeed();
  g.fail();
  g.assertAllowed();
});

test('isOriginAllowed: mesma origem, lista e ausencia', () => {
  assert.equal(isOriginAllowed('https://concord.app', 'concord.app', []), true);
  assert.equal(isOriginAllowed('https://malicioso.com', 'concord.app', []), false);
  assert.equal(isOriginAllowed('https://outro.app', 'concord.app', ['https://outro.app']), true);
  assert.equal(isOriginAllowed(undefined, 'concord.app', []), true);
  assert.equal(isOriginAllowed('lixo', 'concord.app', []), false);
  assert.equal(isOriginAllowed('null', 'concord.app', []), false);
});

test('parseAllowedOrigins normaliza e descarta invalidos', () => {
  assert.deepEqual(parseAllowedOrigins(' https://a.com/x , nada, http://b.com:8080 '), [
    'https://a.com',
    'http://b.com:8080',
  ]);
  assert.deepEqual(parseAllowedOrigins(undefined), []);
});

test('clientIp so confia em X-Forwarded-For com TRUST_PROXY', () => {
  assert.equal(clientIp('10.0.0.1', '1.2.3.4, 10.0.0.1', false), '10.0.0.1');
  assert.equal(clientIp('10.0.0.1', '1.2.3.4, 10.0.0.1', true), '1.2.3.4');
  assert.equal(clientIp(undefined, undefined, true), 'desconhecido');
});

test('loadLimitConfig usa padrao para valores invalidos', () => {
  const c = loadLimitConfig({
    MAX_SESSIONS: '10',
    MAX_SESSIONS_PER_IP: '-1',
    MAX_PAYLOAD_BYTES: 'x',
  });
  assert.equal(c.maxSessions, 10);
  assert.equal(c.maxSessionsPerIp, 3);
  assert.equal(c.maxPayloadBytes, 256 * 1024);
});
