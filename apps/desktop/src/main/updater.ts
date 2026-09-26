import type { BrowserWindow } from 'electron';
import { app } from 'electron';
import { log } from './diagnostics';
import { markQuitting } from './background';

/**
 * Atualizacao automatica via GitHub Releases.
 *
 * Duas regras moldam este modulo:
 *
 * 1. Ninguem precisa saber que existe atualizacao. O check roda sozinho, o
 *    download roda sozinho e a instalacao acontece no proximo encerramento do
 *    app (autoInstallOnAppQuit). Assim uma versao publicada chega a todas as
 *    maquinas sem pedir nada - importante porque o log de operacoes so
 *    converge se os peers rodarem o mesmo reducer.
 *
 * 2. NUNCA reiniciar durante uma chamada. O padrao do electron-updater e
 *    oferecer "reinicie agora"; aqui a instalacao imediata so acontece se o
 *    usuario pedir E nao houver call. Se o download terminar no meio de uma
 *    conversa, a atualizacao fica guardada em silencio e o convite para
 *    reiniciar aparece quando a chamada acabar.
 */

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'unsupported'
  | 'error';

export interface UpdateStatus {
  state: UpdateState;
  /** Versao encontrada no servidor, quando ha uma. */
  version: string | null;
  /** 0-100 durante o download. */
  percent: number;
  message: string | null;
  /**
   * true quando o download terminou mas a instalacao esta represada porque o
   * usuario esta numa chamada. A UI usa isso para nao insistir.
   */
  waitingForCall: boolean;
}

/** Intervalo entre verificacoes. Seis horas cobre o dia sem pesar na rede. */
const INTERVALO_CHECK_MS = 6 * 60 * 60 * 1000;

/**
 * Espera antes do primeiro check. O boot ja disputa CPU com a sincronizacao
 * P2P e com o SQLite; baixar um instalador junto atrasaria a janela.
 */
const ATRASO_PRIMEIRO_CHECK_MS = 20_000;

let status: UpdateStatus = {
  state: 'idle',
  version: null,
  percent: 0,
  message: null,
  waitingForCall: false,
};

let getWindow: (() => BrowserWindow | null) | null = null;
let emCall = false;
let timer: NodeJS.Timeout | null = null;
let iniciado = false;

function publicar(parcial: Partial<UpdateStatus>): void {
  status = { ...status, ...parcial };
  getWindow?.()?.webContents.send('update:status', status);
}

export function updateStatus(): UpdateStatus {
  return status;
}

/**
 * Carregado tardiamente: em desenvolvimento o electron-updater lanca ao nao
 * encontrar app-update.yml, e um import no topo do arquivo derrubaria o
 * processo principal antes de qualquer log.
 */
function updater() {
  const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');
  return autoUpdater;
}

export function initUpdater(janela: () => BrowserWindow | null): void {
  getWindow = janela;
  if (iniciado) return;
  iniciado = true;

  // Sem empacotamento nao ha instalador para substituir: o updater nao tem o
  // que fazer, e a UI precisa saber disso para nao mostrar um estado travado.
  if (!app.isPackaged) {
    publicar({ state: 'unsupported', message: 'Atualizacao automatica so no app instalado' });
    return;
  }

  let auto: ReturnType<typeof updater>;
  try {
    auto = updater();
  } catch (error) {
    log('error', `updater indisponivel: ${String(error)}`);
    publicar({ state: 'unsupported', message: 'Atualizacao automatica indisponivel' });
    return;
  }

  auto.autoDownload = true;
  /**
   * O coracao do pedido "nao feche meu programa, estamos em call": a troca de
   * binario acontece quando o app encerra por vontade do usuario, nunca por
   * iniciativa do updater.
   */
  auto.autoInstallOnAppQuit = true;
  auto.logger = {
    info: (m: unknown) => log('info', `updater: ${String(m)}`),
    warn: (m: unknown) => log('info', `updater: ${String(m)}`),
    error: (m: unknown) => log('error', `updater: ${String(m)}`),
    debug: () => undefined,
  };

  auto.on('checking-for-update', () => publicar({ state: 'checking', message: null }));

  auto.on('update-available', (info) => {
    log('info', `atualizacao encontrada: ${info.version}`);
    publicar({ state: 'downloading', version: info.version, percent: 0, message: null });
  });

  auto.on('update-not-available', () =>
    publicar({ state: 'idle', version: null, percent: 0, message: null }),
  );

  auto.on('download-progress', (p) =>
    publicar({ state: 'downloading', percent: Math.round(p.percent) }),
  );

  auto.on('update-downloaded', (info) => {
    log('info', `atualizacao ${info.version} pronta para instalar`);
    publicar({
      state: 'ready',
      version: info.version,
      percent: 100,
      message: null,
      // Em chamada, a UI mostra apenas um aviso discreto; o convite para
      // reiniciar aparece quando a call terminar.
      waitingForCall: emCall,
    });
  });

  auto.on('error', (error) => {
    // Falha de update nao e falha do app: sem internet, sem release publicado
    // ou GitHub fora do ar sao todos casos normais. Registra e segue.
    log('error', `updater: ${error.message}`);
    publicar({ state: 'error', message: 'Nao foi possivel verificar atualizacoes' });
  });

  setTimeout(() => void check(), ATRASO_PRIMEIRO_CHECK_MS);
  timer = setInterval(() => void check(), INTERVALO_CHECK_MS);
}

export async function check(): Promise<UpdateStatus> {
  if (!app.isPackaged || status.state === 'checking' || status.state === 'downloading') {
    return status;
  }
  // Ja baixada: checar de novo so reiniciaria o ciclo sem ganho.
  if (status.state === 'ready') return status;
  try {
    await updater().checkForUpdates();
  } catch (error) {
    log('error', `falha ao verificar atualizacao: ${String(error)}`);
    publicar({ state: 'error', message: 'Nao foi possivel verificar atualizacoes' });
  }
  return status;
}

/**
 * Reinicia e instala. Recusa enquanto houver chamada ativa - mesmo se a UI
 * pedir, porque a decisao de nao cortar audio nao deve depender de a tela
 * estar em sincronia com o estado da call.
 */
export function installNow(): { ok: boolean; motivo?: string } {
  if (status.state !== 'ready') return { ok: false, motivo: 'Nenhuma atualizacao baixada' };
  if (emCall) {
    publicar({ waitingForCall: true });
    return { ok: false, motivo: 'Chamada em andamento' };
  }

  log('info', 'instalando atualizacao a pedido do usuario');
  // markQuitting evita que o handler de "close" esconda a janela na bandeja em
  // vez de deixar o app encerrar: o processo continuaria vivo e o instalador
  // esperaria para sempre.
  markQuitting();
  // isForceRunAfter: o app volta sozinho depois de instalar.
  setImmediate(() => updater().quitAndInstall(false, true));
  return { ok: true };
}

/**
 * Chamado pelo IPC de chamada. Ao sair da call, se havia atualizacao presa, a
 * UI e avisada: agora da para reiniciar sem cortar ninguem.
 */
export function noteCallActive(active: boolean): void {
  if (emCall === active) return;
  emCall = active;
  if (status.state !== 'ready') return;
  publicar({ waitingForCall: active });
}

export function stopUpdater(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
