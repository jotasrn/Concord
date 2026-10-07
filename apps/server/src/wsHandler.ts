import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { cpus, totalmem } from 'node:os';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PERMISSION_LIST, ROLE_PRESETS, parseVoiceSignal } from '@concord/core';
import { Session } from './session';
import { deviceDir, ensureDir, isValidDeviceToken, removeIfEmpty } from './devices';
import { ConnectionLimiter, LimitConfig, UnlockGuard, WindowRateLimiter, clientIp } from './limits';

type Reply<T> = { id: string; ok: true; data: T } | { id: string; ok: false; error: string };

function reply<T>(id: string, data: T): Reply<T> {
  return { id, ok: true, data };
}
function replyErr(id: string, error: string): Reply<never> {
  return { id, ok: false, error };
}

/** Fechamento quando o mesmo dispositivo abre em outra aba - o cliente nao reconecta. */
export const CLOSE_REPLACED = 4001;
/** Cliente nao se identificou a tempo ou mandou token invalido. */
export const CLOSE_BAD_HELLO = 4002;

export interface WsHandlerOptions {
  dataDir: string;
  limits: LimitConfig;
  trustProxy: boolean;
}

interface Ativo {
  ws: WebSocket;
  /** Resolve quando a sessao terminou de fechar (SQLite e no P2P liberados). */
  encerrada: Promise<void>;
}

/**
 * Cada dispositivo (token gerado pelo navegador) tem sua pasta e no maximo uma
 * Session viva. Recarregar a pagina reabre a mesma conta; abrir uma segunda
 * aba derruba a primeira, em vez de abrir o mesmo SQLite duas vezes e subir
 * dois nos P2P com a mesma identidade.
 */
export function createWsHandler(
  wss: WebSocketServer,
  opts: WsHandlerOptions,
): {
  activeDirs: () => Set<string>;
} {
  const { dataDir, limits } = opts;
  const limiter = new ConnectionLimiter(limits.maxSessions, limits.maxSessionsPerIp);
  const ativos = new Map<string, Ativo>();

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const ip = clientIp(req.socket.remoteAddress, req.headers['x-forwarded-for'], opts.trustProxy);
    const recusa = limiter.acquire(ip);
    if (recusa) {
      ws.close(1013, recusa);
      return;
    }

    let session: Session | null = null;
    // Impede dois hello simultaneos na mesma conexao, ambos esperando a aba
    // anterior fechar e depois abrindo duas sessoes na mesma pasta.
    let helloEmAndamento = false;
    let dir: string | null = null;
    let fimDaSessao: () => void = () => undefined;
    const chamadas = new WindowRateLimiter(limits.callsPerWindow, limits.callWindowMs);
    const ctx: Contexto = {
      session: null as unknown as Session,
      unlockGuard: new UnlockGuard(limits.maxUnlockFailures, limits.unlockLockoutMs),
      messageBuckets: new Map(),
      settingsPath: '',
    };

    const helloTimer = setTimeout(() => {
      if (!session) ws.close(CLOSE_BAD_HELLO, 'Identificacao nao recebida');
    }, limits.helloTimeoutMs);

    function send(payload: unknown): void {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    }

    async function hello(token: unknown): Promise<void> {
      if (session || helloEmAndamento) throw new Error('Sessao ja identificada');
      helloEmAndamento = true;
      if (!isValidDeviceToken(token)) {
        ws.close(CLOSE_BAD_HELLO, 'Token de dispositivo invalido');
        throw new Error('Token de dispositivo invalido');
      }
      const alvo = deviceDir(dataDir, token);

      // Mesma pasta aberta em outra conexao: fecha a antiga e espera ela
      // soltar o SQLite antes de abrir de novo.
      const anterior = ativos.get(alvo);
      if (anterior) {
        anterior.ws.close(CLOSE_REPLACED, 'Aberto em outra aba');
        await anterior.encerrada;
      }
      if (ws.readyState !== WebSocket.OPEN) throw new Error('Conexao encerrada');

      ensureDir(alvo);
      dir = alvo;
      session = new Session(
        alvo,
        (serverId) => send({ type: 'sync:updated', serverId }),
        (serverId, signal) => send({ type: 'voice:incoming', serverId, signal }),
        (info) => send({ type: 'migration:notice', info }),
        (snapshot) => send({ type: 'presence:update', peers: snapshot }),
        (evento, dados) => send({ type: 'social:event', evento, dados }),
      );
      ctx.session = session;
      ctx.settingsPath = join(alvo, 'settings.json');
      ativos.set(alvo, { ws, encerrada: new Promise<void>((r) => (fimDaSessao = r)) });
      clearTimeout(helloTimer);
    }

    ws.on('message', async (raw: import('ws').RawData) => {
      let msgId = 'unknown';
      try {
        const msg = JSON.parse(raw.toString()) as {
          id: string;
          channel: string;
          args: unknown[];
        };
        if (!msg || typeof msg !== 'object' || typeof msg.channel !== 'string') {
          throw new Error('Mensagem malformada');
        }
        msgId = typeof msg.id === 'string' ? msg.id.slice(0, 64) : 'unknown';
        const args = Array.isArray(msg.args) ? msg.args : [];

        if (!chamadas.take()) {
          throw new Error(`Requisicoes demais. Aguarde ${chamadas.retryAfterSeconds()}s.`);
        }

        if (msg.channel === 'session:hello') {
          await hello(args[0]);
          send(reply(msgId, true));
          return;
        }
        if (!session) throw new Error('Sessao nao identificada');

        const result = await dispatch(ctx, msg.channel, args);
        send(reply(msgId, result));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erro inesperado';
        send(replyErr(msgId, message));
      }
    });

    // Sem este listener, um erro de protocolo (ex.: mensagem acima de
    // maxPayload) vira excecao nao tratada e derruba o processo inteiro da
    // ponte - todos os usuarios juntos. O ws ja fecha a conexao sozinho.
    ws.on('error', (err) => {
      console.warn(`[ws] erro de protocolo de ${ip}: ${err.message}`);
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      limiter.release(ip);
      const s = session;
      const d = dir;
      if (!s || !d) return;
      void s
        .shutdown()
        .catch((err) => console.error('[ws] erro ao encerrar sessao', err))
        .finally(() => {
          if (ativos.get(d)?.ws === ws) ativos.delete(d);
          // Pasta de quem abriu a pagina e nunca criou conta: nada a guardar.
          try {
            removeIfEmpty(d);
          } catch (err) {
            console.error('[ws] erro ao limpar pasta', err);
          }
          fimDaSessao();
        });
    });
  });

  return { activeDirs: () => new Set(ativos.keys()) };
}

interface Contexto {
  session: Session;
  unlockGuard: UnlockGuard;
  /** Rate-limit de mensagens por canal, desta conexao - nao global. */
  messageBuckets: Map<string, RateBucket>;
  settingsPath: string;
}

// ---------------------------------------------------------------------------
// Rate-limit de mensagens (idêntico ao do IPC Electron)
// ---------------------------------------------------------------------------
interface RateBucket {
  count: number;
  resetAt: number;
}
const MESSAGE_LIMIT = 5;
const MESSAGE_WINDOW_MS = 3_000;

/**
 * Antes o mapa era global e indexado so pelo canal: um usuario mandando
 * mensagens bloqueava todos os outros usuarios da ponte naquele canal, e o
 * mapa crescia para sempre. Agora cada conexao tem o seu.
 */
function checkRateLimit(buckets: Map<string, RateBucket>, channelId: string): void {
  const now = Date.now();
  const bucket = buckets.get(channelId);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(channelId, { count: 1, resetAt: now + MESSAGE_WINDOW_MS });
    return;
  }
  if (bucket.count >= MESSAGE_LIMIT) {
    const wait = Math.ceil((bucket.resetAt - now) / 1000);
    throw new Error(`Muitas mensagens. Aguarde ${wait}s antes de enviar novamente.`);
  }
  bucket.count += 1;
}

// ---------------------------------------------------------------------------
// Configuracoes por dispositivo
// ---------------------------------------------------------------------------
const DEFAULT_WEB_SETTINGS = {
  resources: {
    maxHeapMb: null,
    maxCores: null,
    maxStorageMb: null,
    runInBackground: true,
    startWithSystem: false,
  },
  video: {
    cameraDeviceId: null,
    cameraHeight: 720,
    cameraFrameRate: 30,
    screenPresetId: 'gaming',
  },
};

function readWebSettings(path: string): typeof DEFAULT_WEB_SETTINGS {
  try {
    if (!existsSync(path)) return DEFAULT_WEB_SETTINGS;
    const bruto = JSON.parse(readFileSync(path, 'utf8')) as Partial<typeof DEFAULT_WEB_SETTINGS>;
    return {
      resources: { ...DEFAULT_WEB_SETTINGS.resources, ...bruto.resources },
      video: { ...DEFAULT_WEB_SETTINGS.video, ...bruto.video },
    };
  } catch {
    return DEFAULT_WEB_SETTINGS;
  }
}

// ---------------------------------------------------------------------------
// Validação de IDs
// ---------------------------------------------------------------------------
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_HEX64 = /^[0-9a-f]{64}$/;

function assertId(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} invalido`);
  const v = value.trim();
  if (!RE_UUID.test(v) && !RE_HEX64.test(v)) throw new Error(`${label} invalido`);
  return v;
}

function sanitizeContent(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

// ---------------------------------------------------------------------------
// Dispatcher — espelha os handlers IPC do Electron
// ---------------------------------------------------------------------------
async function dispatch(ctx: Contexto, channel: string, args: unknown[]): Promise<unknown> {
  const { session } = ctx;
  switch (channel) {
    // --- conta ---
    case 'account:status':
      return {
        hasAccount: session.hasAccount(),
        unlocked: session.isUnlocked(),
        displayName: session.accountName(),
      };
    case 'account:newPhrase':
      return session.newRecoveryPhrase();
    case 'account:create': {
      const [displayName, password, phrase] = args as [string, string, string];
      session.createAccount(displayName, password, phrase);
      return true;
    }
    case 'account:restore': {
      const [displayName, password, phrase, confirmOverwrite] = args as [
        string,
        string,
        string,
        boolean?,
      ];
      session.restoreAccount(displayName, password, phrase, confirmOverwrite === true);
      return true;
    }
    case 'account:unlock': {
      const [password] = args as [string];
      if (typeof password !== 'string') throw new Error('Senha invalida');
      if (session.isUnlocked()) return session.profile();
      ctx.unlockGuard.assertAllowed();
      try {
        await session.unlock(password);
      } catch (err) {
        ctx.unlockGuard.fail();
        throw err;
      }
      ctx.unlockGuard.succeed();
      return session.profile();
    }
    case 'account:profile':
      return session.profile();

    // --- servidores ---
    case 'servers:list':
      return session.requireStore().listServers();
    case 'servers:create': {
      const [name] = args as [string];
      const store = session.requireStore();
      const serverId = store.createServer(name);
      await session.requireNode().joinServer(serverId);
      session.requireNode().broadcast(serverId, store.operationsFor(serverId));
      return serverId;
    }
    case 'servers:join': {
      const [serverId] = args as [string];
      await session.requireNode().joinServer(serverId);
      return true;
    }

    // --- membros ---
    case 'members:list': {
      const [serverId] = args as [string];
      return session.requireStore().listMembers(serverId);
    }
    case 'members:add': {
      const [serverId, userKey, displayName] = args as [string, string, string];
      const chave = userKey.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(chave)) throw new Error('Chave publica invalida');
      await session.publish(serverId, () => {
        session.requireStore().addMember(serverId, chave, displayName);
        return true;
      });
      return session.sendServerInvite(serverId, chave);
    }
    case 'members:nick': {
      const [serverId, userKey, nickname] = args as [string, string, string | null];
      return session.publish(serverId, () => {
        session.requireStore().setNickname(serverId, userKey, nickname);
        return true;
      });
    }
    case 'members:role': {
      const [serverId, userKey, permissions, roleName] = args as [string, string, string, string];
      return session.publish(serverId, () => {
        session.requireStore().setRole(serverId, userKey, BigInt(permissions), roleName);
        return true;
      });
    }
    case 'members:mute': {
      const [serverId, userKey, muted] = args as [string, string, boolean];
      return session.publish(serverId, () => {
        session.requireStore().setMuted(serverId, userKey, muted);
        return true;
      });
    }
    case 'members:kick': {
      const [serverId, userKey] = args as [string, string];
      return session.publish(serverId, () => {
        session.requireStore().kickMember(serverId, userKey);
        return true;
      });
    }

    // --- canais ---
    case 'channels:list': {
      const [serverId] = args as [string];
      return session.requireStore().listChannels(serverId);
    }
    case 'channels:create': {
      const [serverId, name, type] = args as [string, string, 'TEXT' | 'VOICE'];
      return session.publish(serverId, () =>
        session.requireStore().createChannel(serverId, name, type),
      );
    }

    // --- mensagens ---
    case 'messages:list': {
      const [channelId, limit] = args as [string, number | undefined];
      return session.requireStore().listMessages(channelId, limit ?? 50);
    }
    case 'messages:send': {
      const [serverId, channelId, content, replyToId] = args as [
        string,
        string,
        string,
        (string | null | undefined)?,
      ];
      const sid = assertId(serverId, 'serverId');
      const cid = assertId(channelId, 'channelId');
      const rid = replyToId ? assertId(replyToId, 'replyToId') : null;
      checkRateLimit(ctx.messageBuckets, cid);
      const trimmed = sanitizeContent(content).trim();
      if (!trimmed) throw new Error('Mensagem vazia');
      if (trimmed.length > 4000) throw new Error('Mensagem muito longa');
      return session.publish(sid, () => session.requireStore().sendMessage(sid, cid, trimmed, rid));
    }
    case 'messages:delete': {
      const [serverId, messageId] = args as [string, string];
      return session.publish(serverId, () => {
        session.requireStore().deleteMessage(serverId, messageId);
        return true;
      });
    }

    // --- rede ---
    case 'network:status':
      return { peers: session.peerCount(), online: session.isUnlocked() };

    // --- voz ---
    case 'voice:signal': {
      const [serverId, signal] = args as [string, unknown];
      const valido = parseVoiceSignal(signal);
      if (!valido) throw new Error('Sinal de voz invalido');
      session.sendVoiceSignal(serverId, valido);
      return true;
    }

    // --- convites ---
    case 'invites:create': {
      const [serverId] = args as [string];
      return session.createInvite(serverId);
    }
    case 'invites:accept': {
      const [code] = args as [string];
      return session.acceptInvite(code);
    }

    // --- perfil e presenca ---
    case 'profile:update': {
      const [profile] = args as [
        { displayName: string; avatar: string | null; bio: string | null },
      ];
      const nome = profile.displayName?.trim();
      if (!nome) throw new Error('Escolha um nome de exibicao');
      if (nome.length > 64) throw new Error('Nome muito longo');
      if (profile.bio && profile.bio.length > 300) throw new Error('Biografia muito longa');
      if (profile.avatar && profile.avatar.length > 48_000) throw new Error('Imagem muito grande');
      await session.updateProfile({
        displayName: nome,
        avatar: profile.avatar ?? null,
        bio: profile.bio?.trim() || null,
      });
      return true;
    }
    case 'profile:get': {
      const [userKey] = args as [string];
      return session.profileOf(userKey);
    }
    case 'presence:set': {
      const [status] = args as ['ONLINE' | 'IDLE' | 'DND' | 'INVISIBLE'];
      session.setStatus(status);
      return true;
    }
    case 'presence:get':
      return session.presence();
    case 'presence:voice': {
      const [channelId] = args as [string | null];
      session.setVoiceChannel(channelId);
      return true;
    }

    // --- amigos ---
    case 'friends:list':
      return session.listFriends();
    case 'friends:request': {
      const [targetKey] = args as [string];
      return session.sendFriendRequest(targetKey.trim().toLowerCase());
    }
    case 'friends:respond': {
      const [targetKey, accepted] = args as [string, boolean];
      await session.respondFriendRequest(targetKey, accepted);
      return true;
    }
    case 'friends:remove': {
      const [targetKey] = args as [string];
      session.removeFriend(targetKey);
      return true;
    }

    // --- convites de servidor ---
    case 'invites:pending':
      return session.listPendingInvites();
    case 'invites:send': {
      const [serverId, targetKey] = args as [string, string];
      return session.sendServerInvite(serverId, targetKey.trim().toLowerCase());
    }
    case 'invites:acceptPending': {
      const [serverId] = args as [string];
      return session.acceptServerInvite(serverId);
    }
    case 'invites:decline': {
      const [serverId] = args as [string];
      session.declineServerInvite(serverId);
      return true;
    }

    // --- configuracoes ---
    case 'settings:get':
      // Existia no cliente web mas nao aqui: a tela de configuracoes quebrava
      // com "Canal IPC desconhecido".
      return {
        settings: readWebSettings(ctx.settingsPath),
        machine: { cores: cpus().length, totalMemoryMb: Math.round(totalmem() / 1024 / 1024) },
      };
    case 'settings:save': {
      const [settings] = args as [unknown];
      const bruto = JSON.stringify(settings ?? {});
      if (bruto.length > 4096) throw new Error('Configuracoes grandes demais');
      writeFileSync(ctx.settingsPath, bruto, 'utf8');
      return true;
    }
    case 'settings:usage':
      return session.storageUsage();
    case 'settings:prune': {
      const [days] = args as [number];
      return session.pruneHistory(days);
    }

    // --- overlay (no-op na versao web) ---
    case 'overlay:update':
    case 'overlay:hide':
      return true;

    // --- desktop sources (nao disponivel no browser) ---
    case 'desktop:sources':
      throw new Error('Captura de tela nao disponivel na versao web');

    // --- roles ---
    case 'members:roles': {
      return {
        presets: ROLE_PRESETS.map((r) => ({
          id: r.id,
          label: r.label,
          description: r.description,
          permissions: r.permissions.toString(),
        })),
        permissions: PERMISSION_LIST.map((p) => ({
          flag: String(p.flag),
          label: p.label,
          hint: p.hint,
        })),
      };
    }

    case 'settings:callActive':
      return true; // No-op: power save blocker e especifico do Electron

    default:
      throw new Error(`Canal IPC desconhecido: ${channel}`);
  }
}
