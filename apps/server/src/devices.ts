import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Pasta de dados por dispositivo na ponte web.
 *
 * Antes, cada conexao WebSocket ganhava uma pasta com UUID aleatorio. Isso
 * tinha tres efeitos ruins: a conta sumia a cada F5 (a conexao nova caia numa
 * pasta vazia), o disco crescia para sempre (nada apagava as pastas) e
 * qualquer um podia criar pastas em massa so abrindo conexoes.
 *
 * Agora o navegador gera um token aleatorio de 32 bytes, guarda localmente e
 * o apresenta ao conectar. A pasta e derivada do SHA-256 do token - o token
 * em si nunca vai para o disco, entao quem le a pasta de dados nao consegue se
 * passar pelo dispositivo. O token nao substitui a senha: a chave privada
 * continua cifrada no keystore e so abre com ela.
 */

const RE_TOKEN = /^[0-9a-f]{64}$/;
const RE_LEGACY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const KEYSTORE_FILE = 'keystore.json';

export function isValidDeviceToken(token: unknown): token is string {
  return typeof token === 'string' && RE_TOKEN.test(token);
}

export function devicesRoot(dataDir: string): string {
  return join(dataDir, 'devices');
}

/** Pasta do dispositivo. Lanca se o token nao tiver o formato esperado. */
export function deviceDir(dataDir: string, token: string): string {
  if (!isValidDeviceToken(token)) throw new Error('Token de dispositivo invalido');
  const id = createHash('sha256').update(token, 'utf8').digest('hex');
  return join(devicesRoot(dataDir), id);
}

/** Uma pasta sem keystore nunca chegou a ter conta - nada de valor nela. */
export function hasAccount(dir: string): boolean {
  return existsSync(join(dir, KEYSTORE_FILE));
}

/** Apaga a pasta do dispositivo se ela nao guarda conta nenhuma. */
export function removeIfEmpty(dir: string): boolean {
  if (!existsSync(dir) || hasAccount(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

export interface SweepResult {
  removidas: number;
  /** Pastas antigas (por conexao) que tem conta: mantidas, so recuperaveis pela frase. */
  legadasComConta: number;
}

/**
 * Faxina na inicializacao: remove pastas de dispositivo sem conta e as pastas
 * antigas por-conexao (nome UUID na raiz) que tambem nao tem conta. As antigas
 * COM conta ficam - apagar destruiria historico local que o dono pode querer;
 * ele recupera a conta pela frase num dispositivo novo e os peers reenviam o
 * resto.
 */
export function sweepDataDir(
  dataDir: string,
  ativos: ReadonlySet<string> = new Set(),
): SweepResult {
  const resultado: SweepResult = { removidas: 0, legadasComConta: 0 };
  if (!existsSync(dataDir)) return resultado;

  for (const nome of readdirSync(dataDir)) {
    if (!RE_LEGACY.test(nome)) continue;
    const dir = join(dataDir, nome);
    if (!statSync(dir).isDirectory()) continue;
    if (removeIfEmpty(dir)) resultado.removidas += 1;
    else resultado.legadasComConta += 1;
  }

  const raiz = devicesRoot(dataDir);
  if (existsSync(raiz)) {
    for (const nome of readdirSync(raiz)) {
      const dir = join(raiz, nome);
      if (ativos.has(dir) || !statSync(dir).isDirectory()) continue;
      if (removeIfEmpty(dir)) resultado.removidas += 1;
    }
  }
  return resultado;
}

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
