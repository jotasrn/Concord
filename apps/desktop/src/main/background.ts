import { join } from 'node:path';
import { BrowserWindow, Menu, Tray, app, nativeImage, powerSaveBlocker } from 'electron';
import { log } from './diagnostics';

let tray: Tray | null = null;
let blockerId: number | null = null;
/** Sai de verdade ao encerrar, em vez de apenas esconder a janela. */
let saindoDeVez = false;

export function isQuitting(): boolean {
  return saindoDeVez;
}

export function markQuitting(): void {
  saindoDeVez = true;
}

/**
 * Impede o sistema de suspender enquanto ha chamada.
 *
 * Sem isso o Windows pode entrar em suspensao ou reduzir o relogio no meio de
 * uma call, cortando audio de quem esta do outro lado.
 */
export function setCallActive(active: boolean): void {
  if (active && blockerId === null) {
    blockerId = powerSaveBlocker.start('prevent-app-suspension');
    log('info', 'bloqueio de suspensao ativado (chamada em andamento)');
  } else if (!active && blockerId !== null) {
    powerSaveBlocker.stop(blockerId);
    blockerId = null;
    log('info', 'bloqueio de suspensao liberado');
  }
}

function trayIcon(): Electron.NativeImage {
  const caminho = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../../build/icon.png');
  const imagem = nativeImage.createFromPath(caminho);
  // A bandeja do Windows espera algo pequeno; a arte original e grande.
  return imagem.isEmpty() ? imagem : imagem.resize({ width: 16, height: 16 });
}

/**
 * Icone na bandeja com menu.
 *
 * Fechar a janela passa a esconder em vez de encerrar, para que a
 * sincronizacao e as chamadas continuem. Encerrar de verdade fica no menu da
 * bandeja - explicito, para o usuario nao ficar sem saber como sair.
 */
export function setupTray(getWindow: () => BrowserWindow | null): void {
  if (tray) return;

  tray = new Tray(trayIcon());
  tray.setToolTip('Concord');

  const mostrar = () => {
    const window = getWindow();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  };

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir Concord', click: mostrar },
      { type: 'separator' },
      {
        label: 'Encerrar',
        click: () => {
          markQuitting();
          app.quit();
        },
      },
    ]),
  );

  tray.on('double-click', mostrar);
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
