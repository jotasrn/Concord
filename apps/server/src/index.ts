import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { createWsHandler } from './wsHandler';
import { sweepDataDir } from './devices';
import { isOriginAllowed, loadLimitConfig, parseAllowedOrigins } from './limits';

const PORT = Number(process.env.PORT ?? 3001);
const DATA_DIR = process.env.DATA_DIR ?? join(process.env.HOME ?? '.', '.concord-server');

const LIMITS = loadLimitConfig();
const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// Faxina de pastas sem conta deixadas por versoes anteriores ou por quedas.
const faxina = sweepDataDir(DATA_DIR);
if (faxina.removidas > 0 || faxina.legadasComConta > 0) {
  console.log(
    `[concord-server] faxina: ${faxina.removidas} pasta(s) vazia(s) removida(s), ` +
      `${faxina.legadasComConta} conta(s) de versao antiga mantida(s) (recuperaveis pela frase)`,
  );
}

const app = express();
app.use(express.json({ limit: '1mb' }));

// ---------------------------------------------------------------------------
// Seguranca
// ---------------------------------------------------------------------------

/**
 * Em producao, redireciona HTTP -> HTTPS.
 * Hospedagens como Railway/Render encaminham com o header X-Forwarded-Proto.
 */
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (
    process.env.NODE_ENV === 'production' &&
    req.headers['x-forwarded-proto'] !== 'https'
  ) {
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }
  next();
});

/** Headers de segurança padrão. */
app.use((_req: express.Request, res: express.Response, next: express.NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:",
  );
  next();
});

// ---------------------------------------------------------------------------
// Frontend estático (build do apps/web)
// ---------------------------------------------------------------------------
const STATIC_DIR = join(__dirname, '../../web/dist');
if (existsSync(STATIC_DIR)) {
  app.use(express.static(STATIC_DIR));
  // SPA fallback: tudo que não for asset vai para index.html
  app.get('*', (_req: express.Request, res: express.Response) => {
    res.sendFile(join(STATIC_DIR, 'index.html'));
  });
} else {
  app.get('/', (_req: express.Request, res: express.Response) => {
    res.json({ ok: true, message: 'Concord Server rodando. Frontend não encontrado em dist/.' });
  });
}

// ---------------------------------------------------------------------------
// Servidor HTTP + WebSocket
// ---------------------------------------------------------------------------
const httpServer = createServer(app);
const wss = new WebSocketServer({
  server: httpServer,
  path: '/ws',
  maxPayload: LIMITS.maxPayloadBytes,
  // Recusa no handshake (HTTP 401) pagina de outro dominio tentando usar a sessao
  // de quem visitou - Cross-Site WebSocket Hijacking.
  verifyClient: ({ origin, req }: { origin: string; req: import('node:http').IncomingMessage }) =>
    isOriginAllowed(origin || undefined, req.headers.host, ALLOWED_ORIGINS),
});
const ws = createWsHandler(wss, { dataDir: DATA_DIR, limits: LIMITS, trustProxy: TRUST_PROXY });

// Faxina periodica: pastas que sobraram de quedas sem 'close'.
setInterval(() => sweepDataDir(DATA_DIR, ws.activeDirs()), 60 * 60 * 1000).unref();

function encerrar(): void {
  console.log('[concord-server] encerrando');
  for (const cliente of wss.clients) cliente.close(1001, 'Servidor reiniciando');
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on('SIGTERM', encerrar);
process.on('SIGINT', encerrar);

httpServer.listen(PORT, () => {
  console.log(`[concord-server] ouvindo em http://localhost:${PORT}`);
  console.log(`[concord-server] dados em ${DATA_DIR}`);
});
