import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { generateRecoveryPhrase } from '@concord/core';
import { CLOSE_REPLACED, createWsHandler } from './wsHandler';
import { devicesRoot } from './devices';
import { LimitConfig, isOriginAllowed } from './limits';

const LIMITES: LimitConfig = {
  maxSessions: 10,
  maxSessionsPerIp: 10,
  maxPayloadBytes: 64 * 1024,
  callsPerWindow: 100,
  callWindowMs: 1000,
  maxUnlockFailures: 2,
  unlockLockoutMs: 60_000,
  helloTimeoutMs: 2_000,
};

interface Ambiente {
  url: string;
  dataDir: string;
  fechar: () => Promise<void>;
}

async function subir(limites: Partial<LimitConfig> = {}): Promise<Ambiente> {
  const dataDir = mkdtempSync(join(tmpdir(), 'concord-ws-'));
  const http: Server = createServer();
  const cfg = { ...LIMITES, ...limites };
  const wss = new WebSocketServer({
    server: http,
    path: '/ws',
    maxPayload: cfg.maxPayloadBytes,
    verifyClient: ({ origin, req }: { origin: string; req: IncomingMessage }) =>
      isOriginAllowed(origin || undefined, req.headers.host, []),
  });
  createWsHandler(wss, { dataDir, limits: cfg, trustProxy: false });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  const { port } = http.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${port}/ws`,
    dataDir,
    fechar: async () => {
      for (const c of wss.clients) c.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => http.close(() => r()));
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

class Cliente {
  private seq = 0;
  private readonly pend = new Map<string, (r: { ok: boolean; data?: unknown; error?: string }) => void>();
  readonly fechado: Promise<{ code: number }>;

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && this.pend.has(m.id)) {
        this.pend.get(m.id)!(m);
        this.pend.delete(m.id);
      }
    });
    this.fechado = new Promise((r) => ws.on('close', (code) => r({ code })));
  }

  static abrir(url: string, headers: Record<string, string> = {}): Promise<Cliente> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { headers });
      const c = new Cliente(ws);
      ws.once('open', () => {
        // Erros de protocolo viram 'close' com codigo - e o que os testes olham.
        ws.on('error', () => undefined);
        resolve(c);
      });
      ws.once('error', reject);
    });
  }

  call(channel: string, ...args: unknown[]): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    const id = String(++this.seq);
    return new Promise((r) => {
      this.pend.set(id, r);
      this.ws.send(JSON.stringify({ id, channel, args }));
    });
  }

  fechar(): Promise<{ code: number }> {
    this.ws.close();
    return this.fechado;
  }
}

const TOKEN = 'e'.repeat(64);

test('ponte exige identificacao antes de qualquer canal', async () => {
  const amb = await subir();
  try {
    const c = await Cliente.abrir(amb.url);
    const r = await c.call('account:status');
    assert.equal(r.ok, false);
    assert.match(r.error ?? '', /nao identificada/);
    await c.fechar();
  } finally {
    await amb.fechar();
  }
});

test('token invalido derruba a conexao e nao cria pasta', async () => {
  const amb = await subir();
  try {
    const c = await Cliente.abrir(amb.url);
    // Sem await: a ponte fecha a conexao em vez de responder.
    void c.call('session:hello', '../../etc/passwd');
    const { code } = await c.fechado;
    assert.equal(code, 4002);
    assert.equal(existsSync(devicesRoot(amb.dataDir)), false);
  } finally {
    await amb.fechar();
  }
});

test('conta sobrevive a reconexao com o mesmo token (o F5 nao perde a conta)', async () => {
  const amb = await subir();
  try {
    const a = await Cliente.abrir(amb.url);
    assert.equal((await a.call('session:hello', TOKEN)).ok, true);
    const criar = await a.call('account:create', 'Joao', 'senha-forte-123', generateRecoveryPhrase());
    assert.equal(criar.ok, true, criar.error);
    await a.fechar();

    const b = await Cliente.abrir(amb.url);
    await b.call('session:hello', TOKEN);
    const st = await b.call('account:status');
    assert.deepEqual(st.data, { hasAccount: true, unlocked: false, displayName: 'Joao' });
    await b.fechar();

    const outro = await Cliente.abrir(amb.url);
    await outro.call('session:hello', 'f'.repeat(64));
    const st2 = await outro.call('account:status');
    assert.equal((st2.data as { hasAccount: boolean }).hasAccount, false, 'outro token, outra pasta');
    await outro.fechar();
  } finally {
    await amb.fechar();
  }
});

test('pasta de quem nunca criou conta e apagada ao desconectar', async () => {
  const amb = await subir();
  try {
    const c = await Cliente.abrir(amb.url);
    await c.call('session:hello', TOKEN);
    assert.equal(readdirSync(devicesRoot(amb.dataDir)).length, 1);
    await c.fechar();
    // O close do servidor e assincrono (shutdown da sessao).
    for (let i = 0; i < 50 && readdirSync(devicesRoot(amb.dataDir)).length > 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(readdirSync(devicesRoot(amb.dataDir)).length, 0);
  } finally {
    await amb.fechar();
  }
});

test('segunda aba com o mesmo token assume e a primeira fecha com 4001', async () => {
  const amb = await subir();
  try {
    const a = await Cliente.abrir(amb.url);
    await a.call('session:hello', TOKEN);
    const b = await Cliente.abrir(amb.url);
    const ok = await b.call('session:hello', TOKEN);
    assert.equal(ok.ok, true);
    assert.equal((await a.fechado).code, CLOSE_REPLACED);
    assert.equal((await b.call('account:status')).ok, true);
    await b.fechar();
  } finally {
    await amb.fechar();
  }
});

test('limite de conexoes por IP', async () => {
  const amb = await subir({ maxSessionsPerIp: 1 });
  try {
    const a = await Cliente.abrir(amb.url);
    const b = await Cliente.abrir(amb.url);
    assert.equal((await b.fechado).code, 1013);
    await a.fechar();
  } finally {
    await amb.fechar();
  }
});

test('Origin de outro dominio e recusado no handshake', async () => {
  const amb = await subir();
  try {
    await assert.rejects(Cliente.abrir(amb.url, { Origin: 'https://malicioso.example' }), /401/);
  } finally {
    await amb.fechar();
  }
});

test('mensagem acima de maxPayload derruba a conexao', async () => {
  const amb = await subir({ maxPayloadBytes: 1024 });
  try {
    const c = await Cliente.abrir(amb.url);
    c.ws.send('x'.repeat(4096));
    assert.equal((await c.fechado).code, 1009);
  } finally {
    await amb.fechar();
  }
});

test('mensagem malformada responde erro sem derrubar', async () => {
  const amb = await subir();
  try {
    const c = await Cliente.abrir(amb.url);
    const resposta = new Promise<string>((r) => c.ws.once('message', (m) => r(m.toString())));
    c.ws.send('null');
    assert.match(await resposta, /malformada/);
    assert.equal((await c.call('session:hello', TOKEN)).ok, true);
    await c.fechar();
  } finally {
    await amb.fechar();
  }
});

test('desbloqueio trava apos tentativas erradas', async () => {
  const amb = await subir();
  try {
    const c = await Cliente.abrir(amb.url);
    await c.call('session:hello', TOKEN);
    await c.call('account:create', 'Joao', 'senha-forte-123', generateRecoveryPhrase());
    assert.equal((await c.call('account:unlock', 'errada-1')).ok, false);
    assert.equal((await c.call('account:unlock', 'errada-2')).ok, false);
    const travado = await c.call('account:unlock', 'senha-forte-123');
    assert.equal(travado.ok, false);
    assert.match(travado.error ?? '', /Tentativas demais/);
    await c.fechar();
  } finally {
    await amb.fechar();
  }
});

test('settings:get e settings:save existem na ponte', async () => {
  const amb = await subir();
  try {
    const c = await Cliente.abrir(amb.url);
    await c.call('session:hello', TOKEN);
    const g = await c.call('settings:get');
    assert.equal(g.ok, true, g.error);
    const s = g.data as { settings: { video: { cameraHeight: number } } };
    s.settings.video.cameraHeight = 480;
    assert.equal((await c.call('settings:save', s.settings)).ok, true);
    const g2 = await c.call('settings:get');
    assert.equal((g2.data as typeof s).settings.video.cameraHeight, 480);
    await c.fechar();
  } finally {
    await amb.fechar();
  }
});

test('dois hello simultaneos na mesma conexao: so o primeiro vale', async () => {
  const amb = await subir();
  try {
    const c = await Cliente.abrir(amb.url);
    const [r1, r2] = await Promise.all([
      c.call('session:hello', TOKEN),
      c.call('session:hello', TOKEN),
    ]);
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, false);
    assert.match(r2.error ?? '', /ja identificada/);
    await c.fechar();
  } finally {
    await amb.fechar();
  }
});
