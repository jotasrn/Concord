import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import cookieParser from 'cookie-parser';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { createWsHandler } from './wsHandler';

const PORT = Number(process.env.PORT ?? 3001);
const DATA_DIR = process.env.DATA_DIR ?? join(process.env.HOME ?? '.', '.concord-server');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const app = express();
app.use(cookieParser());
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
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
createWsHandler(wss, DATA_DIR);

httpServer.listen(PORT, () => {
  console.log(`[concord-server] ouvindo em http://localhost:${PORT}`);
  console.log(`[concord-server] dados em ${DATA_DIR}`);
});
