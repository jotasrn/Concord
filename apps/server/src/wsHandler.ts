import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { join } from 'node:path';
import { Session } from './session';

type Reply<T> = { id: string; ok: true; data: T } | { id: string; ok: false; error: string };

function reply<T>(id: string, data: T): Reply<T> {
  return { id, ok: true, data };
}
function replyErr(id: string, error: string): Reply<never> {
  return { id, ok: false, error };
}

/**
 * Cada conexao WebSocket tem sua propria Session isolada.
 * Isso garante que dois usuarios no mesmo servidor nao compartilhem estado.
 */
export function createWsHandler(wss: WebSocketServer, dataDir: string): void {
  wss.on('connection', (ws: WebSocket) => {
    const clientId = uuidv4();
    console.log(`[ws] conexao ${clientId}`);

    const sessionDir = join(dataDir, clientId);
    const session = new Session(
      sessionDir,
      (serverId) => send({ type: 'sync:updated', serverId }),
      (serverId, signal) => send({ type: 'voice:incoming', serverId, signal }),
      (info) => send({ type: 'migration:notice', info }),
      (snapshot) => send({ type: 'presence:update', peers: snapshot }),
      (evento, dados) => send({ type: 'social:event', evento, dados }),
    );

    function send(payload: unknown): void {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    }

    ws.on('message', async (raw: import('ws').RawData) => {
      let msgId = 'unknown';
      try {
        const msg = JSON.parse(raw.toString()) as {
          id: string;
          channel: string;
          args: unknown[];
        };
        msgId = msg.id;
        const result = await dispatch(session, msg.channel, msg.args ?? []);
        ws.send(JSON.stringify(reply(msgId, result)));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erro inesperado';
        ws.send(JSON.stringify(replyErr(msgId, message)));
      }
    });

    ws.on('close', () => {
      console.log(`[ws] desconexao ${clientId}`);
      void session.shutdown();
    });
  });
}

// ---------------------------------------------------------------------------
// Rate-limit de mensagens (idêntico ao do IPC Electron)
// ---------------------------------------------------------------------------
interface RateBucket { count: number; resetAt: number; }
const MESSAGE_LIMIT = 5;
const MESSAGE_WINDOW_MS = 3_000;
const rateBuckets = new Map<string, RateBucket>();

function checkRateLimit(channelId: string): void {
  const now = Date.now();
  const bucket = rateBuckets.get(channelId);
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(channelId, { count: 1, resetAt: now + MESSAGE_WINDOW_MS });
    return;
  }
  if (bucket.count >= MESSAGE_LIMIT) {
    const wait = Math.ceil((bucket.resetAt - now) / 1000);
    throw new Error(`Muitas mensagens. Aguarde ${wait}s antes de enviar novamente.`);
  }
  bucket.count += 1;
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
async function dispatch(session: Session, channel: string, args: unknown[]): Promise<unknown> {
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
      const [displayName, password, phrase] = args as [string, string, string];
      session.restoreAccount(displayName, password, phrase);
      return true;
    }
    case 'account:unlock': {
      const [password] = args as [string];
      const identity = await session.unlock(password);
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
      const [serverId, channelId, content] = args as [string, string, string];
      const sid = assertId(serverId, 'serverId');
      const cid = assertId(channelId, 'channelId');
      checkRateLimit(cid);
      const trimmed = sanitizeContent(content).trim();
      if (!trimmed) throw new Error('Mensagem vazia');
      if (trimmed.length > 4000) throw new Error('Mensagem muito longa');
      return session.publish(sid, () =>
        session.requireStore().sendMessage(sid, cid, trimmed),
      );
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
      session.sendVoiceSignal(serverId, signal);
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
      const [profile] = args as [{ displayName: string; avatar: string | null; bio: string | null }];
      const nome = profile.displayName?.trim();
      if (!nome) throw new Error('Escolha um nome de exibicao');
      if (nome.length > 64) throw new Error('Nome muito longo');
      if (profile.bio && profile.bio.length > 300) throw new Error('Biografia muito longa');
      if (profile.avatar && profile.avatar.length > 48_000) throw new Error('Imagem muito grande');
      await session.updateProfile({ displayName: nome, avatar: profile.avatar ?? null, bio: profile.bio?.trim() || null });
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
      // Importacao lazy para nao carregar o modulo sem necessidade.
      const { ROLE_PRESETS, PERMISSION_LIST } = require('@concord/core') as typeof import('@concord/core');
      return {
        presets: ROLE_PRESETS.map((r: any) => ({
          id: r.id,
          label: r.label,
          description: r.description,
          permissions: r.permissions.toString(),
        })),
        permissions: PERMISSION_LIST.map((p: any) => ({
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
