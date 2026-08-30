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

  registerVoiceAndInviteIpc(session);
  registerScreenIpc();
  void getWindow;
}

/** Handlers de voz e convites, registrados junto com os demais. */
export function registerVoiceAndInviteIpc(session: Session): void {
  ipcMain.handle('voice:signal', (_e, serverId: string, signal: unknown) =>
    wrap(() => {
      session.sendVoiceSignal(serverId, signal);
      return true;
    }),
  );

  ipcMain.handle('invites:create', (_e, serverId: string) =>
    wrap(() => session.createInvite(serverId)),
  );

  ipcMain.handle('invites:accept', (_e, code: string) =>
    wrap(() => session.acceptInvite(code)),
  );
}

/**
 * Fontes de captura de tela.
 *
 * Usamos desktopCapturer em vez do seletor nativo do sistema porque assim o
 * app controla a interface de escolha: miniaturas ao vivo, separacao entre
 * telas e janelas, icone do aplicativo. O seletor nativo tambem nao existe de
 * forma consistente entre plataformas.
 */
export function registerScreenIpc(): void {
  ipcMain.handle('desktop:sources', () =>
    wrap(async () => {
      const { desktopCapturer } = require('electron') as typeof import('electron');
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        // Miniatura pequena: o custo aqui e serializar imagem por IPC, e a
        // lista pode ter dezenas de janelas.
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true,
      });

      return sources
        .filter((source) => !source.thumbnail.isEmpty())
        .map((source) => ({
          id: source.id,
          name: source.name,
          kind: source.id.startsWith('screen:') ? ('screen' as const) : ('window' as const),
          // JPEG em vez de PNG: mesma miniatura com uma fracao dos bytes.
          thumbnail: `data:image/jpeg;base64,${source.thumbnail.toJPEG(70).toString('base64')}`,
          appIcon: source.appIcon && !source.appIcon.isEmpty()
            ? `data:image/png;base64,${source.appIcon.toPNG().toString('base64')}`
            : null,
        }));
    }),
  );
}
