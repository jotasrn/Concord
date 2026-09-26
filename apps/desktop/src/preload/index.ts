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
    nick: (serverId: string, userKey: string, nickname: string | null) =>
      call<boolean>('members:nick', serverId, userKey, nickname),
    role: (serverId: string, userKey: string, permissions: string, roleName: string) =>
      call<boolean>('members:role', serverId, userKey, permissions, roleName),
    mute: (serverId: string, userKey: string, muted: boolean) =>
      call<boolean>('members:mute', serverId, userKey, muted),
    kick: (serverId: string, userKey: string) =>
      call<boolean>('members:kick', serverId, userKey),
    roles: () =>
      call<{
        presets: { id: string; label: string; description: string; permissions: string }[];
        permissions: { flag: string; label: string; hint: string }[];
      }>('members:roles'),
    add: (serverId: string, userKey: string, displayName: string) =>
      call<'entregue' | 'na-fila'>('members:add', serverId, userKey, displayName),
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
  friends: {
    list: () =>
      call<
        {
          userKey: string;
          displayName: string;
          avatar: string | null;
          state: 'PENDING_IN' | 'PENDING_OUT' | 'ACCEPTED';
          createdAt: number;
        }[]
      >('friends:list'),
    request: (targetKey: string) =>
      call<'entregue' | 'na-fila'>('friends:request', targetKey),
    respond: (targetKey: string, accepted: boolean) =>
      call<boolean>('friends:respond', targetKey, accepted),
    remove: (targetKey: string) => call<boolean>('friends:remove', targetKey),
  },
  serverInvites: {
    pending: () =>
      call<
        { serverId: string; serverName: string; fromKey: string; code: string; createdAt: number }[]
      >('invites:pending'),
    send: (serverId: string, targetKey: string) =>
      call<'entregue' | 'na-fila'>('invites:send', serverId, targetKey),
    accept: (serverId: string) => call<string>('invites:acceptPending', serverId),
    decline: (serverId: string) => call<boolean>('invites:decline', serverId),
  },
  onSocialEvent: (handler: (evento: string, dados: any) => void) => {
    const listener = (_e: unknown, evento: string, dados: any) => handler(evento, dados);
    ipcRenderer.on('social:event', listener);
    return () => ipcRenderer.removeListener('social:event', listener);
  },
  overlay: {
    update: (
      participants: {
        key: string;
        name: string;
        avatar: string | null;
        speaking: boolean;
        muted: boolean;
      }[],
      visivel: boolean,
    ) => call<boolean>('overlay:update', participants, visivel),
    hide: () => call<boolean>('overlay:hide'),
  },
  settings: {
    get: () =>
      call<{
        settings: {
          resources: {
            maxHeapMb: number | null;
            maxCores: number | null;
            maxStorageMb: number | null;
            runInBackground: boolean;
            startWithSystem: boolean;
          };
          video: {
            cameraDeviceId: string | null;
            cameraHeight: number;
            cameraFrameRate: number;
            screenPresetId: string;
          };
        };
        machine: { cores: number; totalMemoryMb: number };
      }>('settings:get'),
    save: (settings: unknown) => call<boolean>('settings:save', settings),
    usage: () =>
      call<{ operations: number; messages: number; avatarBytes: number; diskBytes: number }>(
        'settings:usage',
      ),
    prune: (olderThanDays: number) =>
      call<{ removed: number }>('settings:prune', olderThanDays),
    setCallActive: (active: boolean) => call<boolean>('settings:callActive', active),
  },
  update: {
    status: () => call<import('../main/updater').UpdateStatus>('update:status'),
    check: () => call<import('../main/updater').UpdateStatus>('update:check'),
    install: () => call<{ ok: boolean; motivo?: string }>('update:install'),
    onStatus: (handler: (status: import('../main/updater').UpdateStatus) => void) => {
      const listener = (_e: unknown, status: import('../main/updater').UpdateStatus) =>
        handler(status);
      ipcRenderer.on('update:status', listener);
      return () => ipcRenderer.removeListener('update:status', listener);
    },
  },
  profile: {
    update: (profile: { displayName: string; avatar: string | null; bio: string | null }) =>
      call<boolean>('profile:update', profile),
    get: (userKey: string) =>
      call<{
        userKey: string;
        displayName: string;
        avatar: string | null;
        bio: string | null;
      } | null>('profile:get', userKey),
  },
  presence: {
    set: (status: 'ONLINE' | 'IDLE' | 'DND' | 'INVISIBLE') =>
      call<boolean>('presence:set', status),
    get: () =>
      call<{ status: string; peers: Record<string, { status: string; voice: string | null }> }>(
        'presence:get',
      ),
    setVoiceChannel: (channelId: string | null) =>
      call<boolean>('presence:voice', channelId),
    onUpdate: (
      handler: (peers: Record<string, { status: string; voice: string | null }>) => void,
    ) => {
      const listener = (
        _e: unknown,
        peers: Record<string, { status: string; voice: string | null }>,
      ) => handler(peers);
      ipcRenderer.on('presence:update', listener);
      return () => ipcRenderer.removeListener('presence:update', listener);
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
