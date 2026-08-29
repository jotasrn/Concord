import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app, dialog } from 'electron';

/**
 * Modulo carregado ANTES de qualquer outro no processo principal.
 *
 * Se um import pesado (core, modulo nativo) falhar, o Electron mostra apenas
 * uma caixa "Error" generica e o processo morre sem deixar rastro. Registrando
 * os handlers primeiro, a causa real vai para o arquivo de log.
 */
export const logPath = join(app.getPath('userData'), 'concord.log');

export function log(level: 'info' | 'error', message: string): void {
  const line = `${new Date().toISOString()} [${level}] ${message}\n`;
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    appendFileSync(logPath, line);
  } catch {
    // Sem log em disco, resta o console do modo dev.
  }
  if (level === 'error') console.error(line.trim());
  else console.log(line.trim());
}

export function fatal(error: unknown): void {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  log('error', message);
  try {
    dialog.showErrorBox(
      'Concord falhou ao iniciar',
      `${error instanceof Error ? error.message : String(error)}\n\nDetalhes em:\n${logPath}`,
    );
  } catch {
    // showErrorBox pode falhar antes do app estar pronto; o log ja foi gravado.
  }
  app.quit();
}

process.on('uncaughtException', fatal);
process.on('unhandledRejection', (reason) => log('error', `unhandledRejection: ${String(reason)}`));

log('info', `--- inicio | packaged=${app.isPackaged} | ${app.getVersion()} ---`);
