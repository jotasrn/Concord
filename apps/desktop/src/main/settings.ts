import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { cpus, totalmem } from 'node:os';
import { dirname, join } from 'node:path';

export interface ResourceSettings {
  /**
   * Teto do heap de JavaScript em MB, ou null para o padrao do sistema.
   *
   * Limita o heap do V8, nao a memoria total do processo: buffers de video,
   * decodificacao e o proprio Chromium ficam fora dessa conta. Ainda assim e
   * o que mais cresce num app de chat, porque e onde vivem as operacoes.
   */
  maxHeapMb: number | null;
  /** Quantos nucleos o processo pode usar, ou null para todos. */
  maxCores: number | null;
  /** Teto de armazenamento em MB para o historico local, ou null para ilimitado. */
  maxStorageMb: number | null;
  /** Continuar rodando ao fechar a janela, em vez de encerrar. */
  runInBackground: boolean;
  /** Iniciar junto com o Windows. */
  startWithSystem: boolean;
}

export interface AppSettings {
  resources: ResourceSettings;
  /** Preferencias de video guardadas entre sessoes. */
  video: {
    cameraDeviceId: string | null;
    cameraHeight: number;
    cameraFrameRate: number;
    screenPresetId: string;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  resources: {
    maxHeapMb: null,
    maxCores: null,
    maxStorageMb: null,
    runInBackground: true,
    startWithSystem: false,
  },
  video: {
    cameraDeviceId: null,
    cameraHeight: 720,
    cameraFrameRate: 30,
    screenPresetId: 'gaming',
  },
};

export function readSettings(path: string): AppSettings {
  try {
    const bruto = JSON.parse(readFileSync(path, 'utf8')) as Partial<AppSettings>;
    return {
      resources: { ...DEFAULT_SETTINGS.resources, ...bruto.resources },
      video: { ...DEFAULT_SETTINGS.video, ...bruto.video },
    };
  } catch {
    // Arquivo ausente ou corrompido: seguir com o padrao e melhor que nao abrir.
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function writeSettings(path: string, settings: AppSettings): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2), 'utf8');
}

export function machineResources(): { cores: number; totalMemoryMb: number } {
  return {
    cores: cpus().length,
    totalMemoryMb: Math.round(totalmem() / 1024 / 1024),
  };
}

/**
 * Restringe o processo a um numero de nucleos.
 *
 * O Windows expoe isso como mascara de bits: cada bit ligado e um nucleo
 * liberado. Nao existe API no Node para mexer nisso, entao vai por PowerShell.
 * Processos filhos herdam a afinidade, o que cobre os renderers do Chromium.
 */
export function applyCoreLimit(maxCores: number | null): void {
  if (process.platform !== 'win32') return;

  const total = cpus().length;
  const usar = maxCores === null ? total : Math.min(Math.max(1, maxCores), total);
  const mascara = 2 ** usar - 1;

  execFile(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$p = Get-Process -Id ${process.pid}; $p.ProcessorAffinity = ${mascara}`,
    ],
    () => {
      // Falhar aqui e aceitavel: o app roda com todos os nucleos, so nao
      // respeita a preferencia. Nao vale impedir a inicializacao por isso.
    },
  );
}

/** Caminho do arquivo de preferencias dentro do userData. */
export function settingsPath(userData: string): string {
  return join(userData, 'settings.json');
}
