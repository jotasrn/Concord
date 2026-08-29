import { BrowserWindow, ipcMain } from 'electron';
import { Session } from './session';

/**
 * Todo IPC responde no mesmo envelope { ok, data } | { ok, error }. O renderer
 * nunca recebe uma excecao crua: mensagens de erro internas nao devem virar
 * texto de UI sem passar por aqui.
 */
type Reply<T> = { ok: true; data: T } | { ok: false; error: string };

function wrap<T>(fn: () => T | Promise<T>): Promise<Reply<T>> {
  return Promise.resolve()
    .then(fn)
    .then((data) => ({ ok: true as const, data }))
    .catch((error: unknown) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : 'Erro inesperado',
    }));
}

export function registerIpc(session: Session, getWindow: () => BrowserWindow | null): void {
  // ---------- conta ----------

  ipcMain.handle('account:status', () =>
    wrap(() => ({
      hasAccount: session.hasAccount(),
      unlocked: session.isUnlocked(),
      displayName: session.accountName(),
    })),
  );

  ipcMain.handle('account:newPhrase', () => wrap(() => session.newRecoveryPhrase()));

  ipcMain.handle(
    'account:create',
    (_e, displayName: string, password: string, phrase: string) =>
      wrap(() => {
        session.createAccount(displayName, password, phrase);
        return true;
      }),
  );

  ipcMain.handle(
    'account:restore',
    (_e, displayName: string, password: string, phrase: string) =>
      wrap(() => {
        session.restoreAccount(displayName, password, phrase);
        return true;
      }),
  );

  ipcMain.handle('account:unlock', (_e, password: string) =>
    wrap(async () => {
      await session.unlock(password);
      return session.profile();
    }),
  );

  ipcMain.handle('account:profile', () => wrap(() => session.profile()));

  // ---------- servidores e canais ----------

  ipcMain.handle('servers:list', () => wrap(() => session.requireStore().listServers()));

  ipcMain.handle('servers:create', (_e, name: string) =>
    wrap(async () => {
      const store = session.requireStore();
      const serverId = store.createServer(name);
      await session.requireNode().joinServer(serverId);
      session.requireNode().broadcast(serverId, store.operationsFor(serverId));
      return serverId;
    }),
  );

  ipcMain.handle('servers:join', (_e, serverId: string) =>
    wrap(async () => {
      // Entra no topico da DHT para receber o log de quem ja esta la. So vira
      // membro de fato quando o dono publicar o member.join correspondente.
      await session.requireNode().joinServer(serverId);
      return true;
    }),
  );

  ipcMain.handle('members:list', (_e, serverId: string) =>
    wrap(() => session.requireStore().listMembers(serverId)),
  );

  ipcMain.handle('members:add', (_e, serverId: string, userKey: string, displayName: string) =>
    wrap(() =>
      session.publish(serverId, () => {
        session.requireStore().addMember(serverId, userKey, displayName);
        return true;
      }),
    ),
  );

  ipcMain.handle('channels:list', (_e, serverId: string) =>
    wrap(() => session.requireStore().listChannels(serverId)),
  );

  ipcMain.handle(
    'channels:create',
    (_e, serverId: string, name: string, type: 'TEXT' | 'VOICE') =>
      wrap(() =>
        session.publish(serverId, () =>
          session.requireStore().createChannel(serverId, name, type),
        ),
      ),
  );

  // ---------- mensagens ----------

  ipcMain.handle('messages:list', (_e, channelId: string, limit?: number) =>
    wrap(() => session.requireStore().listMessages(channelId, limit ?? 50)),
  );

  ipcMain.handle(
    'messages:send',
    (_e, serverId: string, channelId: string, content: string) =>
      wrap(() => {
        const trimmed = content.trim();
        if (!trimmed) throw new Error('Mensagem vazia');
        if (trimmed.length > 4000) throw new Error('Mensagem muito longa');
        return session.publish(serverId, () =>
          session.requireStore().sendMessage(serverId, channelId, trimmed),
        );
      }),
  );

  ipcMain.handle('messages:delete', (_e, serverId: string, messageId: string) =>
    wrap(() =>
      session.publish(serverId, () => {
        session.requireStore().deleteMessage(serverId, messageId);
        return true;
      }),
    ),
  );

  // ---------- rede ----------

  ipcMain.handle('network:status', () =>
    wrap(() => ({ peers: session.peerCount(), online: session.isUnlocked() })),
  );

  void getWindow;
}
