/**
 * Adaptador WebSocket para a versao web do Concord.
 *
 * Implementa a mesma interface de window.concord que o preload do Electron
 * expoe, mas usa WebSocket em vez de ipcRenderer. Assim o codigo React nao
 * precisa saber se esta rodando dentro do Electron ou no browser.
 *
 * Instalacao: chamado em main.tsx antes de renderizar, quando window.concord
 * ainda nao existe (ou seja, nao estamos no Electron).
 */

type Reply<T> = { id: string; ok: true; data: T } | { id: string; ok: false; error: string };

/** Resolve/rejeita promises pendentes por ID de mensagem. */
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

/** Handlers registrados para eventos push do servidor. */
const pushHandlers = new Map<string, Set<(...args: unknown[]) => void>>();

let ws: WebSocket | null = null;
let msgCounter = 0;

function nextId(): string {
  return String(++msgCounter);
}

function onPush(type: string, handler: (...args: unknown[]) => void): () => void {
  if (!pushHandlers.has(type)) pushHandlers.set(type, new Set());
  pushHandlers.get(type)!.add(handler);
  return () => pushHandlers.get(type)?.delete(handler);
}

function connect(): Promise<void> {
  return new Promise((resolve, reject) => {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${protocol}://${location.host}/ws`;
    ws = new WebSocket(url);

    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('Nao foi possivel conectar ao servidor Concord'));

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string) as
        | Reply<unknown>
        | { type: string; [key: string]: unknown };

      // Evento push (sem id de requisicao)
      if ('type' in msg && !('id' in msg)) {
        const handlers = pushHandlers.get(msg.type);
        if (handlers) {
          for (const h of handlers) {
            if (msg.type === 'sync:updated') h(msg.serverId);
            else if (msg.type === 'voice:incoming') h(msg.serverId, msg.signal);
            else if (msg.type === 'presence:update') h(msg.peers);
            else if (msg.type === 'social:event') h(msg.evento, msg.dados);
            else if (msg.type === 'migration:notice') h(msg.info);
          }
        }
        return;
      }

      // Resposta a uma chamada
      const r = msg as Reply<unknown>;
      const p = pending.get(r.id);
      if (!p) return;
      pending.delete(r.id);
      if (r.ok) p.resolve(r.data);
      else p.reject(new Error(r.error));
    };

    ws.onclose = () => {
      // Rejeita todas as chamadas pendentes
      for (const p of pending.values()) p.reject(new Error('Conexao perdida'));
      pending.clear();
      // Tenta reconectar em 3s
      setTimeout(() => void connect().catch(() => undefined), 3000);
    };
  });
}

function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('WebSocket nao conectado'));
      return;
    }
    const id = nextId();
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    ws.send(JSON.stringify({ id, channel, args }));
  });
}

/**
 * Instala window.concord com a implementacao WebSocket.
 * Deve ser chamado antes de ReactDOM.createRoot().
 */
export async function installWebAdapter(): Promise<void> {
  await connect();

  (window as unknown as { concord: unknown }).concord = {
    account: {
      status: () => call('account:status'),
      newPhrase: () => call('account:newPhrase'),
      create: (d: string, p: string, ph: string) => call('account:create', d, p, ph),
      restore: (d: string, p: string, ph: string) => call('account:restore', d, p, ph),
      unlock: (p: string) => call('account:unlock', p),
      profile: () => call('account:profile'),
    },
    servers: {
      list: () => call('servers:list'),
      create: (name: string) => call('servers:create', name),
      join: (id: string) => call('servers:join', id),
    },
    members: {
      list: (sid: string) => call('members:list', sid),
      nick: (sid: string, uk: string, nick: string | null) => call('members:nick', sid, uk, nick),
      role: (sid: string, uk: string, p: string, r: string) => call('members:role', sid, uk, p, r),
      mute: (sid: string, uk: string, m: boolean) => call('members:mute', sid, uk, m),
      kick: (sid: string, uk: string) => call('members:kick', sid, uk),
      roles: () => call('members:roles'),
      add: (sid: string, uk: string, dn: string) => call('members:add', sid, uk, dn),
    },
    channels: {
      list: (sid: string) => call('channels:list', sid),
      create: (sid: string, name: string, type: string) => call('channels:create', sid, name, type),
    },
    messages: {
      list: (cid: string, limit?: number) => call('messages:list', cid, limit),
      send: (sid: string, cid: string, content: string) => call('messages:send', sid, cid, content),
      remove: (sid: string, mid: string) => call('messages:delete', sid, mid),
    },
    voice: {
      signal: (sid: string, signal: unknown) => call('voice:signal', sid, signal),
      onSignal: (handler: (sid: string, signal: unknown) => void) =>
        onPush('voice:incoming', (sid, signal) => handler(sid as string, signal)),
    },
    friends: {
      list: () => call('friends:list'),
      request: (tk: string) => call('friends:request', tk),
      respond: (tk: string, accepted: boolean) => call('friends:respond', tk, accepted),
      remove: (tk: string) => call('friends:remove', tk),
    },
    serverInvites: {
      pending: () => call('invites:pending'),
      send: (sid: string, tk: string) => call('invites:send', sid, tk),
      accept: (sid: string) => call('invites:acceptPending', sid),
      decline: (sid: string) => call('invites:decline', sid),
    },
    onSocialEvent: (handler: (evento: string, dados: unknown) => void) =>
      onPush('social:event', (e, d) => handler(e as string, d)),
    overlay: {
      update: () => Promise.resolve(true),
      hide: () => Promise.resolve(true),
    },
    settings: {
      get: () => call('settings:get'),
      save: (s: unknown) => call('settings:save', s),
      usage: () => call('settings:usage'),
      prune: (days: number) => call('settings:prune', days),
      setCallActive: (active: boolean) => call('settings:callActive', active),
    },
    profile: {
      update: (p: unknown) => call('profile:update', p),
      get: (uk: string) => call('profile:get', uk),
    },
    presence: {
      set: (status: string) => call('presence:set', status),
      get: () => call('presence:get'),
      setVoiceChannel: (cid: string | null) => call('presence:voice', cid),
      onUpdate: (handler: (peers: unknown) => void) => onPush('presence:update', handler),
    },
    screen: {
      // Captura de tela nao esta disponivel na versao web
      sources: () => Promise.resolve([]),
    },
    invites: {
      create: (sid: string) => call('invites:create', sid),
      accept: (code: string) => call('invites:accept', code),
    },
    network: {
      status: () => call('network:status'),
    },
    onSyncUpdate: (handler: (serverId: string) => void) =>
      onPush('sync:updated', (sid) => handler(sid as string)),
    onMigrationNotice: (handler: (info: unknown) => void) =>
      onPush('migration:notice', handler),
  };
}
