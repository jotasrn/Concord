// ATENCAO: diagnostics precisa ser o PRIMEIRO import. Ele instala os handlers
// de excecao antes que qualquer modulo pesado (core, nativos) seja carregado -
// sem isso, uma falha de import vira uma caixa "Error" generica sem rastro.
import { fatal, log } from './diagnostics';
import { join } from 'node:path';
import { BrowserWindow, app, nativeImage, session as electronSession, shell } from 'electron';
import { registerIpc } from './ipc';
import { destroyTray, isQuitting, markQuitting, setCallActive, setupTray } from './background';
import { applyCoreLimit, readSettings, settingsPath } from './settings';
import { initUpdater, noteCallActive, stopUpdater } from './updater';
import type { Session as SessionType } from './session';

const isDev = !app.isPackaged;

/**
 * Preferencias sao lidas antes de qualquer coisa: o teto de heap so tem efeito
 * como flag do V8, e flags precisam ser registradas antes do app ficar pronto.
 */
const settings = readSettings(settingsPath(app.getPath('userData')));

if (settings.resources.maxHeapMb) {
  app.commandLine.appendSwitch('js-flags', `--max-old-space-size=${settings.resources.maxHeapMb}`);
}
applyCoreLimit(settings.resources.maxCores);
let window: BrowserWindow | null = null;
let appSession: SessionType | null = null;

/** Import tardio: uma falha ao carregar o core chega ao log em vez de matar o app. */
function createSession(): SessionType {
  const { Session } = require('./session') as typeof import('./session');
  return new Session(join(app.getPath('userData'), 'data'), (serverId) => {
    // Operacoes chegaram de um peer: avisa a UI para recarregar aquele servidor.
    window?.webContents.send('sync:updated', serverId);
  },
  (serverId, signal) => {
    window?.webContents.send('voice:incoming', serverId, signal);
  },
  (info) => {
    log('info', `migracao de chaves: ${info.migrados} gerada(s), ${info.semChave.length} sem chave`);
    window?.webContents.send('migration:notice', info);
  },
  (snapshot) => {
    window?.webContents.send('presence:update', snapshot);
  },
  (evento, dados) => {
    window?.webContents.send('social:event', evento, dados);
  },
  (callId, signal) => {
    window?.webContents.send('call:incoming-signal', callId, signal);
  });
}

function createWindow(): void {
  // Carrega o icone: em producao fica dentro do asar; em dev usa o arquivo de build.
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../../build/icon.png');
  const icon = nativeImage.createFromPath(iconPath);

  window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#000000',
    show: false,
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // O renderer nao tem acesso ao Node. Toda operacao privilegiada passa
      // pelo IPC, que valida a entrada no processo principal.
      contextIsolation: true,
      nodeIntegration: false,
      /*
       * Sandbox ligado: o renderer (e o proprio preload) rodam na mesma
       * jaula de processo que o Chromium usa pra paginas web normais, sem
       * acesso a nenhuma API do Node alem do que o Electron libera
       * explicitamente. Antes estava desligado sem necessidade - o preload
       * so usa contextBridge/ipcRenderer (ambos funcionam sandboxed) - e
       * um app que roda WebRTC e processa conteudo de outros peers (texto,
       * imagem de avatar, video) e justamente o tipo de superficie que mais
       * se beneficia dessa camada extra caso o Chromium tenha uma falha.
       */
      sandbox: true,
      // O Chromium reduz timers de janelas ocultas. Numa chamada isso cortaria
      // audio ao minimizar, entao o throttling fica desligado.
      backgroundThrottling: false,
    },
  });

  // Fechar esconde na bandeja quando o modo segundo plano esta ligado.
  window.on('close', (event) => {
    if (!isQuitting() && settings.resources.runInBackground) {
      event.preventDefault();
      window?.hide();
    }
  });

  window.once('ready-to-show', () => {
    log('info', 'janela pronta');
    window?.show();
  });

  // Sem isto, uma falha ao carregar o bundle aparece como janela preta e
  // silenciosa: o processo principal nunca fica sabendo.
  window.webContents.on('did-fail-load', (_e, code, description, url) => {
    log('error', `renderer falhou ao carregar ${url}: ${description} (${code})`);
  });
  // Electron 35+ entrega os dados no proprio evento; os argumentos
  // posicionais (level numerico, message, line, sourceId) foram descontinuados.
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error') {
      log('error', `renderer: ${details.message} (${details.sourceId}:${details.lineNumber})`);
    }
  });
  window.webContents.on('render-process-gone', (_e, details) => {
    log('error', `renderer encerrado: ${details.reason}`);
  });

  // Links externos abrem no navegador, nunca dentro da janela do app.
  // Em producao o DevTools fica fechado: ele daria leitura e alteracao do
  // renderer em tempo de execucao. Nao impede quem sabe extrair o asar, mas
  // tira o caminho de um clique.
  if (!isDev) {
    window.webContents.on('before-input-event', (event, input) => {
      const atalhoDevtools =
        input.key === 'F12' ||
        (input.control && input.shift && ['I', 'J', 'C'].includes(input.key.toUpperCase()));
      if (atalhoDevtools) event.preventDefault();
    });
    window.webContents.on('devtools-opened', () => window?.webContents.closeDevTools());
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    /*
     * So http/https chegam ao shell.openExternal.
     *
     * MessageText.tsx ja restringe a isso o que vira link clicavel numa
     * mensagem, mas window.open() pode ser chamado de qualquer lugar do
     * renderer - inclusive de uma falha futura (uma lib de terceiro, um bug
     * de escaping) que injete HTML/JS na pagina. Sem este filtro, QUALQUER
     * esquema chegava direto ao shell.openExternal: `file:///...`,
     * `ms-settings:`, um executavel local - um clique bastava para rodar
     * algo fora do navegador, no proprio sistema operacional.
     */
    try {
      const protocolo = new URL(url).protocol;
      if (protocolo === 'http:' || protocolo === 'https:') {
        void shell.openExternal(url);
      } else {
        log('error', `abertura externa bloqueada por esquema nao permitido: ${protocolo}`);
      }
    } catch {
      // URL nem bem formada - nada a abrir.
    }
    return { action: 'deny' };
  });

  // Bloqueia navegacao para fora do app: um link malicioso numa mensagem nao
  // deve conseguir substituir a janela por uma pagina remota.
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://') && url !== process.env.VITE_DEV_SERVER_URL) {
      event.preventDefault();
      log('error', `navegacao bloqueada para ${url}`);
    }
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    const indexPath = join(__dirname, '../renderer/index.html');
    log('info', `carregando renderer de ${indexPath}`);
    void window.loadFile(indexPath);
  }
}

// Uma instancia por maquina: duas janelas sobre o mesmo SQLite corromperiam o log.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });

  void app.whenReady().then(() => {
    // Permite que o renderer chame getDisplayMedia() para captura de tela.
    // O Electron 28+ exige um handler explicito; sem ele a API e bloqueada.
    // Passando video: undefined, o Electron abre o seletor nativo do OS
    // para o usuario escolher qual janela ou tela compartilhar.
    electronSession.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      callback({});
    });

    try {
      log('info', 'app pronto, iniciando sessao');
      appSession = createSession();
      // O estado da chamada interessa a dois modulos: a bandeja (bloqueio de
      // suspensao) e o updater (nao reiniciar no meio de uma call).
      registerIpc(appSession, () => window, app.getPath('userData'), (active) => {
        setCallActive(active);
        noteCallActive(active);
      });
      createWindow();
      setupTray(() => window);
      initUpdater(() => window);
    } catch (error) {
      fatal(error);
      return;
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    // Com "rodar em segundo plano" ligado, fechar a janela nao encerra: a
    // sincronizacao P2P e as chamadas continuam pela bandeja.
    if (process.platform !== 'darwin' && !settings.resources.runInBackground) {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    markQuitting();
    setCallActive(false);
    stopUpdater();
    destroyTray();
    const { destroyOverlay } = require('./overlay') as typeof import('./overlay');
    destroyOverlay();
    void appSession?.shutdown();
  });
}
