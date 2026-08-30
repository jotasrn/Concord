import { contextBridge, ipcRenderer } from 'electron';

type Reply<T> = { ok: true; data: T } | { ok: false; error: string };

/** Desembrulha o envelope do IPC, transformando falha em excecao no renderer. */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const reply = (await ipcRenderer.invoke(channel, ...args)) as Reply<T>;
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}

/**
 * Unica superficie exposta ao renderer. Nao ha `require`, `fs` nem acesso ao
 * Node do lado da UI: tudo passa por estes metodos nomeados.
 */
const api = {
  account: {
    status: () =>
      call<{ hasAccount: boolean; unlocked: boolean; displayName: string | null }>(
        'account:status',
      ),
    newPhrase: () => call<string>('account:newPhrase'),
    create: (displayName: string, password: string, phrase: string) =>
      call<boolean>('account:create', displayName, password, phrase),
    restore: (displayName: string, password: string, phrase: string) =>
      call<boolean>('account:restore', displayName, password, phrase),
    unlock: (password: string) =>
      call<{ displayName: string; publicKey: string; handle: string }>(
        'account:unlock',
        password,
      ),
    profile: () =>
      call<{ displayName: string; publicKey: string; handle: string }>('account:profile'),
  },
  servers: {
    list: () =>
      call<{ id: string; name: string; icon: string | null; ownerKey: string }[]>('servers:list'),
    create: (name: string) => call<string>('servers:create', name),
    join: (serverId: string) => call<boolean>('servers:join', serverId),
  },
  members: {
    list: (serverId: string) =>
      call<{ userKey: string; displayName: string; permissions: string }[]>(
        'members:list',
        serverId,
      ),
    add: (serverId: string, userKey: string, displayName: string) =>
      call<boolean>('members:add', serverId, userKey, displayName),
  },
  channels: {
    list: (serverId: string) =>
      call<
        {
          id: string;
          serverId: string;
          name: string;
          type: 'TEXT' | 'VOICE';
          topic: string | null;
          position: number;
        }[]
      >('channels:list', serverId),
    create: (serverId: string, name: string, type: 'TEXT' | 'VOICE') =>
      call<string>('channels:create', serverId, name, type),
  },
  messages: {
    list: (channelId: string, limit?: number) =>
      call<
        {
          id: string;
          channelId: string;
          authorKey: string;
          authorName: string;
          content: string;
          replyToId: string | null;
          createdAt: number;
          editedAt: number | null;
        }[]
      >('messages:list', channelId, limit),
    send: (serverId: string, channelId: string, content: string) =>
      call<string>('messages:send', serverId, channelId, content),
    remove: (serverId: string, messageId: string) =>
      call<boolean>('messages:delete', serverId, messageId),
  },
  voice: {
    signal: (serverId: string, signal: unknown) =>
      call<boolean>('voice:signal', serverId, signal),
    onSignal: (handler: (serverId: string, signal: any) => void) => {
      const listener = (_e: unknown, serverId: string, signal: any) => handler(serverId, signal);
      ipcRenderer.on('voice:incoming', listener);
      return () => ipcRenderer.removeListener('voice:incoming', listener);
    },
  },
  screen: {
    sources: () =>
      call<
        {
          id: string;
          name: string;
          kind: 'screen' | 'window';
          thumbnail: string;
          appIcon: string | null;
        }[]
      >('desktop:sources'),
  },
  invites: {
    create: (serverId: string) => call<string>('invites:create', serverId),
    accept: (code: string) => call<string>('invites:accept', code),
  },
  network: {
    status: () => call<{ peers: number; online: boolean }>('network:status'),
  },
  /** Avisa sobre servidores antigos migrados ou sem chave. */
  onMigrationNotice: (handler: (info: { migrados: number; semChave: string[] }) => void) => {
    const listener = (_e: unknown, info: { migrados: number; semChave: string[] }) => handler(info);
    ipcRenderer.on('migration:notice', listener);
    return () => ipcRenderer.removeListener('migration:notice', listener);
  },
  /** Avisa a UI que operacoes novas chegaram de um peer. */
  onSyncUpdate: (handler: (serverId: string) => void) => {
    const listener = (_e: unknown, serverId: string) => handler(serverId);
    ipcRenderer.on('sync:updated', listener);
    return () => ipcRenderer.removeListener('sync:updated', listener);
  },
};

contextBridge.exposeInMainWorld('concord', api);

export type ConcordApi = typeof api;
