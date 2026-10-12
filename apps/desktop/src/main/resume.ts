import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeStorage } from 'electron';
import { log } from './diagnostics';

/**
 * Reabrir sem digitar a senha de novo, por pouco tempo.
 *
 * Ao encerrar, a senha e guardada cifrada pelo Windows (DPAPI, via
 * safeStorage - so o mesmo usuario do Windows consegue ler) junto do horario
 * da saida. Na proxima abertura, se passou menos que RESUME_JANELA_MS, o app
 * destranca sozinho; senao pede a senha como sempre.
 *
 * A troca: durante a janela, quem estiver logado como voce no Windows consegue
 * abrir o Concord sem a senha. Por isso a janela e curta, o arquivo e
 * apagado na primeira leitura (usado ou vencido) e nada e gravado se o app
 * cair em vez de encerrar normalmente.
 */
export const RESUME_JANELA_MS = 10 * 60 * 1000;

const arquivo = (userData: string) => join(userData, 'resume.bin');

export function saveResume(userData: string, password: string): void {
  try {
    if (!safeStorage.isEncryptionAvailable()) return;
    const blob = safeStorage.encryptString(password).toString('base64');
    writeFileSync(arquivo(userData), JSON.stringify({ at: Date.now(), blob }), 'utf8');
  } catch (error) {
    log('error', `nao foi possivel guardar a retomada: ${String(error)}`);
  }
}

/** Ha uma retomada valida? Nao consome o arquivo. */
export function resumeAvailable(userData: string): boolean {
  try {
    const caminho = arquivo(userData);
    if (!existsSync(caminho)) return false;
    const { at } = JSON.parse(readFileSync(caminho, 'utf8')) as { at: number };
    return Date.now() - at < RESUME_JANELA_MS;
  } catch {
    return false;
  }
}

/** Le e APAGA. Devolve a senha, ou null se venceu, falhou ou nao existe. */
export function takeResume(userData: string): string | null {
  const caminho = arquivo(userData);
  try {
    if (!existsSync(caminho)) return null;
    const { at, blob } = JSON.parse(readFileSync(caminho, 'utf8')) as { at: number; blob: string };
    rmSync(caminho, { force: true });
    if (Date.now() - at >= RESUME_JANELA_MS) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(Buffer.from(blob, 'base64'));
  } catch {
    rmSync(caminho, { force: true });
    return null;
  }
}

export function clearResume(userData: string): void {
  rmSync(arquivo(userData), { force: true });
}
