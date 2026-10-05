import { BrowserWindow, app, ipcMain } from 'electron';
import { Session } from './session';

/**
 * Validador de sinal de voz do core, carregado tarde como o resto do core
 * neste processo (ver createSession em index.ts).
 */
function voiceSignal(signal: unknown) {
  const { parseVoiceSignal } = require('@concord/core') as typeof import('@concord/core');
  return parseVoiceSignal(signal);
}

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

// ---------- validacao de entrada ----------

/**
 * IDs de servidor e canal seguem o padrao UUID v4 ou hex-64.
 * Rejeitar qualquer coisa fora disso impede injecao de caminhos ou SQL.
 */
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_HEX64 = /^[0-9a-f]{64}$/;

function assertId(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} invalido`);
  const v = value.trim();
  if (!RE_UUID.test(v) && !RE_HEX64.test(v)) throw new Error(`${label} invalido`);
  return v;
}

/** Remove caracteres de controle que nao devem aparecer em mensagens de chat. */
function sanitizeContent(raw: string): string {
  // Mantem tabulacao (\t=0x09), nova linha (\n=0x0A) e retorno (\r=0x0D).
  // Descarta os demais controles (0x00-0x08, 0x0B-0x0C, 0x0E-0x1F, 0x7F).
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

// ---------- rate-limit de mensagens ----------

interface RateBucket {
  count: number;
  /** Timestamp em ms em que a janela corrente expira. */
  resetAt: number;
}

/** Por canal: max 5 mensagens em 3 segundos. */
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

export function registerIpc(
  session: Session,
  getWindow: () => BrowserWindow | null,
  userData: string,
  onCallActive: (active: boolean) => void,
): void {
  // ---------- conta ----------

  ipcMain.handle('account:status', () =>
    wrap(() => ({
      hasAccount: session.hasAccount(),
      unlocked: session.isUnlocked(),
      displayName: session.accountName(),
    })),
  );

  ipcMain.handle('account:newPhrase', () => wrap(() => session.newRecoveryPhrase()));

  ipcMain.handle('account:create', (_e, displayName: string, password: string, phrase: string) =>
    wrap(() => {
      session.createAccount(displayName, password, phrase);
      return true;
    }),
  );

  ipcMain.handle(
    'account:restore',
    (_e, displayName: string, password: string, phrase: string, confirmOverwrite?: boolean) =>
      wrap(() => {
        session.restoreAccount(displayName, password, phrase, confirmOverwrite === true);
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

  /**
   * Adiciona alguem ao servidor E entrega o convite.
   *
   * Publicar so a operacao nao adianta: sem a chave do servidor a pessoa nao
   * entra no topico e nunca recebe o log onde consta que virou membro. Antes
   * o botao parecia funcionar e nada chegava do outro lado.
   */
  ipcMain.handle('members:add', (_e, serverId: string, userKey: string, displayName: string) =>
    wrap(async () => {
      const chave = userKey.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(chave)) throw new Error('Chave publica invalida');

      await session.publish(serverId, () => {
        session.requireStore().addMember(serverId, chave, displayName);
        return true;
      });

      return session.sendServerInvite(serverId, chave);
    }),
  );

  ipcMain.handle('channels:list', (_e, serverId: string) =>
    wrap(() => session.requireStore().listChannels(serverId)),
  );

  ipcMain.handle('channels:create', (_e, serverId: string, name: string, type: 'TEXT' | 'VOICE') =>
    wrap(() =>
      session.publish(serverId, () => session.requireStore().createChannel(serverId, name, type)),
    ),
  );

  // ---------- mensagens ----------

  ipcMain.handle('messages:list', (_e, channelId: string, limit?: number) =>
    wrap(() => session.requireStore().listMessages(channelId, limit ?? 50)),
  );

  ipcMain.handle('messages:send', (_e, serverId: string, channelId: string, content: string) =>
    wrap(() => {
      const sid = assertId(serverId, 'serverId');
      const cid = assertId(channelId, 'channelId');
      checkRateLimit(cid);
      const trimmed = sanitizeContent(content).trim();
      if (!trimmed) throw new Error('Mensagem vazia');
      if (trimmed.length > 4000) throw new Error('Mensagem muito longa');
      return session.publish(sid, () => session.requireStore().sendMessage(sid, cid, trimmed));
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

  // A versao empacotada (electron-builder le do package.json do app), para a
  // interface poder mostrar o que esta instalado - util para saber se o
  // auto-update ja pegou, e para comparar com o que outra pessoa tem.
  ipcMain.handle('app:version', () => wrap(() => app.getVersion()));

  registerVoiceAndInviteIpc(session);
  registerScreenIpc();
  registerProfileIpc(session);
  registerSettingsIpc(session, userData, onCallActive);
  registerSocialIpc(session);
  registerOverlayIpc();
  registerModerationIpc(session);
  void getWindow;
}

/** Handlers de voz e convites, registrados junto com os demais. */
export function registerVoiceAndInviteIpc(session: Session): void {
  ipcMain.handle('voice:signal', (_e, serverId: string, signal: unknown) =>
    wrap(() => {
      const valido = voiceSignal(signal);
      if (!valido) throw new Error('Sinal de voz invalido');
      session.sendVoiceSignal(serverId, valido);
      return true;
    }),
  );

  ipcMain.handle('invites:create', (_e, serverId: string) =>
    wrap(() => session.createInvite(serverId)),
  );

  ipcMain.handle('invites:accept', (_e, code: string) => wrap(() => session.acceptInvite(code)));
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
          appIcon:
            source.appIcon && !source.appIcon.isEmpty()
              ? `data:image/png;base64,${source.appIcon.toPNG().toString('base64')}`
              : null,
        }));
    }),
  );
}

/** Perfil do usuario e presenca. */
export function registerProfileIpc(session: Session): void {
  ipcMain.handle(
    'profile:update',
    (_e, profile: { displayName: string; avatar: string | null; bio: string | null }) =>
      wrap(async () => {
        const nome = profile.displayName?.trim();
        if (!nome) throw new Error('Escolha um nome de exibicao');
        if (nome.length > 64) throw new Error('Nome muito longo');
        if (profile.bio && profile.bio.length > 300) throw new Error('Biografia muito longa');
        // O avatar ja chega redimensionado pelo renderer; aqui vale o teto que
        // impede inchar o log replicado.
        if (profile.avatar && profile.avatar.length > 48_000) {
          throw new Error('Imagem muito grande, escolha outra');
        }
        await session.updateProfile({
          displayName: nome,
          avatar: profile.avatar ?? null,
          bio: profile.bio?.trim() || null,
        });
        return true;
      }),
  );

  ipcMain.handle('profile:get', (_e, userKey: string) => wrap(() => session.profileOf(userKey)));

  ipcMain.handle('presence:set', (_e, status: 'ONLINE' | 'IDLE' | 'DND' | 'INVISIBLE') =>
    wrap(() => {
      session.setStatus(status);
      return true;
    }),
  );

  ipcMain.handle('presence:get', () => wrap(() => session.presence()));

  ipcMain.handle('presence:voice', (_e, channelId: string | null) =>
    wrap(() => {
      session.setVoiceChannel(channelId);
      return true;
    }),
  );
}

/** Configuracoes de recursos: memoria, nucleos, armazenamento e segundo plano. */
export function registerSettingsIpc(
  session: Session,
  userData: string,
  onCallActive: (active: boolean) => void,
): void {
  const { statSync, existsSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  const settingsModule = require('./settings') as typeof import('./settings');
  const { app } = require('electron') as typeof import('electron');

  const caminho = settingsModule.settingsPath(userData);

  ipcMain.handle('settings:get', () =>
    wrap(() => ({
      settings: settingsModule.readSettings(caminho),
      machine: settingsModule.machineResources(),
    })),
  );

  ipcMain.handle('settings:save', (_e, settings: import('./settings').AppSettings) =>
    wrap(() => {
      settingsModule.writeSettings(caminho, settings);

      // Nucleos valem na hora; o teto de heap so na proxima abertura, porque
      // e uma flag do V8 registrada antes do app iniciar.
      settingsModule.applyCoreLimit(settings.resources.maxCores);
      app.setLoginItemSettings({ openAtLogin: settings.resources.startWithSystem });

      return true;
    }),
  );

  /** Uso real em disco, somando o banco e os arquivos auxiliares do SQLite. */
  ipcMain.handle('settings:usage', () =>
    wrap(() => {
      const dir = join(userData, 'data');
      const tamanho = (arquivo: string) => {
        const alvo = join(dir, arquivo);
        return existsSync(alvo) ? statSync(alvo).size : 0;
      };
      // O WAL pode ficar maior que o proprio banco antes do checkpoint, entao
      // ignora-lo daria um numero enganosamente baixo.
      const bytes = tamanho('concord.db') + tamanho('concord.db-wal') + tamanho('concord.db-shm');

      return { ...session.storageUsage(), diskBytes: bytes };
    }),
  );

  ipcMain.handle('settings:prune', (_e, olderThanDays: number) =>
    wrap(() => session.pruneHistory(olderThanDays)),
  );

  ipcMain.handle('settings:callActive', (_e, active: boolean) =>
    wrap(() => {
      onCallActive(active);
      return true;
    }),
  );

  // ---------- atualizacao ----------
  const updater = require('./updater') as typeof import('./updater');

  ipcMain.handle('update:status', () => wrap(() => updater.updateStatus()));
  ipcMain.handle('update:check', () => wrap(() => updater.check()));
  ipcMain.handle('update:install', () => wrap(() => updater.installNow()));
}

/** Overlay flutuante que aparece sobre jogos. */
export function registerOverlayIpc(): void {
  const { updateOverlay, destroyOverlay } = require('./overlay') as typeof import('./overlay');

  ipcMain.handle(
    'overlay:update',
    (_e, participants: import('./overlay').OverlayParticipant[], visivel: boolean) =>
      wrap(() => {
        updateOverlay(participants, visivel);
        return true;
      }),
  );

  ipcMain.handle('overlay:hide', () =>
    wrap(() => {
      destroyOverlay();
      return true;
    }),
  );
}

/** Amizades e convites de servidor. */
export function registerSocialIpc(session: Session): void {
  ipcMain.handle('friends:list', () => wrap(() => session.listFriends()));

  ipcMain.handle('friends:request', (_e, targetKey: string) =>
    wrap(() => session.sendFriendRequest(targetKey.trim().toLowerCase())),
  );

  ipcMain.handle('friends:respond', (_e, targetKey: string, accepted: boolean) =>
    wrap(async () => {
      await session.respondFriendRequest(targetKey, accepted);
      return true;
    }),
  );

  ipcMain.handle('friends:remove', (_e, targetKey: string) =>
    wrap(() => {
      session.removeFriend(targetKey);
      return true;
    }),
  );

  ipcMain.handle('invites:pending', () => wrap(() => session.listPendingInvites()));

  ipcMain.handle('invites:send', (_e, serverId: string, targetKey: string) =>
    wrap(() => session.sendServerInvite(serverId, targetKey.trim().toLowerCase())),
  );

  ipcMain.handle('invites:acceptPending', (_e, serverId: string) =>
    wrap(() => session.acceptServerInvite(serverId)),
  );

  ipcMain.handle('invites:decline', (_e, serverId: string) =>
    wrap(() => {
      session.declineServerInvite(serverId);
      return true;
    }),
  );

  // ---------- chamada direta ----------

  ipcMain.handle('calls:invite', (_e, targetKey: string, callId: string) =>
    wrap(() => session.callInvite(targetKey, callId)),
  );

  ipcMain.handle('calls:respond', (_e, targetKey: string, callId: string, accepted: boolean) =>
    wrap(async () => {
      await session.callRespond(targetKey, callId, accepted);
      return true;
    }),
  );

  ipcMain.handle('calls:end', (_e, targetKey: string, callId: string) =>
    wrap(async () => {
      await session.callEnd(targetKey, callId);
      return true;
    }),
  );

  ipcMain.handle('calls:signal', (_e, targetKey: string, signal: unknown) =>
    wrap(() => {
      const valido = voiceSignal(signal);
      if (!valido) throw new Error('Sinal de chamada invalido');
      session.sendCallSignal(targetKey, valido);
      return true;
    }),
  );
}

/** Moderacao: apelido, cargo, silenciar e expulsar. */
export function registerModerationIpc(session: Session): void {
  ipcMain.handle('members:nick', (_e, serverId: string, userKey: string, nickname: string | null) =>
    wrap(() =>
      session.publish(serverId, () => {
        session.requireStore().setNickname(serverId, userKey, nickname);
        return true;
      }),
    ),
  );

  ipcMain.handle(
    'members:role',
    (_e, serverId: string, userKey: string, permissions: string, roleName: string) =>
      wrap(() =>
        session.publish(serverId, () => {
          session.requireStore().setRole(serverId, userKey, BigInt(permissions), roleName);
          return true;
        }),
      ),
  );

  ipcMain.handle('members:mute', (_e, serverId: string, userKey: string, muted: boolean) =>
    wrap(() =>
      session.publish(serverId, () => {
        session.requireStore().setMuted(serverId, userKey, muted);
        return true;
      }),
    ),
  );

  ipcMain.handle('members:kick', (_e, serverId: string, userKey: string) =>
    wrap(() =>
      session.publish(serverId, () => {
        session.requireStore().kickMember(serverId, userKey);
        return true;
      }),
    ),
  );

  /** Cargos disponiveis e a lista de permissoes, para a interface montar o menu. */
  ipcMain.handle('members:roles', () =>
    wrap(() => {
      const { ROLE_PRESETS, PERMISSION_LIST } =
        require('@concord/core') as typeof import('@concord/core');
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
    }),
  );
}
