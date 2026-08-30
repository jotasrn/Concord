// ATENCAO: diagnostics precisa ser o PRIMEIRO import. Ele instala os handlers
// de excecao antes que qualquer modulo pesado (core, nativos) seja carregado -
// sem isso, uma falha de import vira uma caixa "Error" generica sem rastro.
import { fatal, log } from './diagnostics';
import { join } from 'node:path';
import { BrowserWindow, app, nativeImage, session as electronSession, shell } from 'electron';
import { registerIpc } from './ipc';
import type { Session as SessionType } from './session';

const isDev = !app.isPackaged;
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
      sandbox: false,
    },
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
  window.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) log('error', `renderer: ${message} (${sourceId}:${line})`);
  });
  window.webContents.on('render-process-gone', (_e, details) => {
    log('error', `renderer encerrado: ${details.reason}`);
  });

  // Links externos abrem no navegador, nunca dentro da janela do app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
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
      registerIpc(appSession, () => window);
      createWindow();
    } catch (error) {
      fatal(error);
      return;
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    void appSession?.shutdown();
  });
}
