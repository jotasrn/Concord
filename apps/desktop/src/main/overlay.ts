import { join } from 'node:path';
import { BrowserWindow, screen } from 'electron';
import { log } from './diagnostics';

export interface OverlayParticipant {
  key: string;
  name: string;
  avatar: string | null;
  speaking: boolean;
  muted: boolean;
}

let overlay: BrowserWindow | null = null;

/**
 * Janela flutuante com quem esta falando, visivel por cima de outros
 * aplicativos.
 *
 * Limite conhecido: jogos em tela cheia EXCLUSIVA assumem o controle do
 * compositor e nada e desenhado por cima. Em "janela sem borda", que e o modo
 * usado pela maioria dos jogos hoje, o overlay aparece normalmente.
 */
export function createOverlay(): BrowserWindow {
  if (overlay && !overlay.isDestroyed()) return overlay;

  const { workArea } = screen.getPrimaryDisplay();

  overlay = new BrowserWindow({
    width: 260,
    height: 400,
    // Canto superior direito, com uma margem.
    x: workArea.x + workArea.width - 280,
    y: workArea.y + 20,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/overlay.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  // 'screen-saver' e o nivel mais alto disponivel: fica acima inclusive de
  // janelas que se declaram sempre-no-topo.
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Cliques atravessam para o que estiver embaixo: o overlay informa, nunca
  // rouba o mouse de quem esta jogando.
  overlay.setIgnoreMouseEvents(true, { forward: true });

  void overlay.loadFile(join(__dirname, '../renderer/overlay.html'));

  overlay.on('closed', () => {
    overlay = null;
  });

  return overlay;
}

/** Mostra ou esconde conforme haja gente na chamada. */
export function updateOverlay(participants: OverlayParticipant[], visivel: boolean): void {
  if (!visivel || participants.length === 0) {
    overlay?.hide();
    return;
  }

  const janela = createOverlay();
  janela.webContents.send('overlay:participants', participants);

  if (!janela.isVisible()) {
    // showInactive: aparecer nao pode tirar o foco do jogo.
    janela.showInactive();
    log('info', 'overlay exibido');
  }
}

export function destroyOverlay(): void {
  if (overlay && !overlay.isDestroyed()) overlay.destroy();
  overlay = null;
}
