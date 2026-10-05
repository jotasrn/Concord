/**
 * Protecoes da ponte WebSocket contra abuso.
 *
 * Cada sessao aberta na ponte sobe um no Hyperswarm e um SQLite - e caro.
 * Sem teto, um script abrindo conexoes em loop derrubava o processo.
 */

export interface LimitConfig {
  /** Sessoes simultaneas no processo inteiro. */
  maxSessions: number;
  /** Sessoes simultaneas por endereco IP. */
  maxSessionsPerIp: number;
  /** Maior mensagem WebSocket aceita, em bytes. */
  maxPayloadBytes: number;
  /** Chamadas por janela, por conexao. */
  callsPerWindow: number;
  callWindowMs: number;
  /** Tentativas de senha erradas antes de travar o desbloqueio. */
  maxUnlockFailures: number;
  unlockLockoutMs: number;
  /** Tempo para o cliente se identificar apos conectar. */
  helloTimeoutMs: number;
}

function inteiro(valor: string | undefined, padrao: number): number {
  const n = Number(valor);
  return Number.isSafeInteger(n) && n > 0 ? n : padrao;
}

export function loadLimitConfig(env: NodeJS.ProcessEnv = process.env): LimitConfig {
  return {
    maxSessions: inteiro(env.MAX_SESSIONS, 50),
    maxSessionsPerIp: inteiro(env.MAX_SESSIONS_PER_IP, 3),
    // O maior payload legitimo e o avatar (48 KB de data URL) + envelope.
    maxPayloadBytes: inteiro(env.MAX_PAYLOAD_BYTES, 256 * 1024),
    callsPerWindow: inteiro(env.CALLS_PER_WINDOW, 60),
    callWindowMs: inteiro(env.CALL_WINDOW_MS, 1_000),
    maxUnlockFailures: inteiro(env.MAX_UNLOCK_FAILURES, 5),
    unlockLockoutMs: inteiro(env.UNLOCK_LOCKOUT_MS, 60_000),
    helloTimeoutMs: inteiro(env.HELLO_TIMEOUT_MS, 10_000),
  };
}

/** Conta sessoes vivas no total e por IP. */
export class ConnectionLimiter {
  private total = 0;
  private readonly porIp = new Map<string, number>();

  constructor(
    private readonly maxTotal: number,
    private readonly maxPorIp: number,
  ) {}

  /** Reserva uma vaga. Devolve o motivo da recusa, ou null se aceitou. */
  acquire(ip: string): string | null {
    if (this.total >= this.maxTotal) return 'Servidor cheio, tente mais tarde';
    const atual = this.porIp.get(ip) ?? 0;
    if (atual >= this.maxPorIp) return 'Conexoes demais a partir deste endereco';
    this.total += 1;
    this.porIp.set(ip, atual + 1);
    return null;
  }

  release(ip: string): void {
    const atual = this.porIp.get(ip) ?? 0;
    if (atual <= 0) return;
    this.total -= 1;
    if (atual === 1) this.porIp.delete(ip);
    else this.porIp.set(ip, atual - 1);
  }

  get active(): number {
    return this.total;
  }
}

/** Janela fixa simples: N eventos por intervalo. */
export class WindowRateLimiter {
  private count = 0;
  private resetAt = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** true se o evento cabe na janela atual. */
  take(): boolean {
    const agora = this.now();
    if (agora >= this.resetAt) {
      this.count = 0;
      this.resetAt = agora + this.windowMs;
    }
    if (this.count >= this.limit) return false;
    this.count += 1;
    return true;
  }

  /** Segundos ate a janela abrir de novo. */
  retryAfterSeconds(): number {
    return Math.max(1, Math.ceil((this.resetAt - this.now()) / 1000));
  }
}

/**
 * Freio contra forca bruta na senha. O keystore usa derivacao lenta, mas sem
 * isto um atacante com o token do dispositivo podia testar senhas sem parar.
 */
export class UnlockGuard {
  private falhas = 0;
  private travadoAte = 0;

  constructor(
    private readonly maxFalhas: number,
    private readonly lockoutMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  assertAllowed(): void {
    const agora = this.now();
    if (agora < this.travadoAte) {
      const s = Math.ceil((this.travadoAte - agora) / 1000);
      throw new Error(`Tentativas demais. Aguarde ${s}s para tentar de novo.`);
    }
  }

  fail(): void {
    this.falhas += 1;
    if (this.falhas >= this.maxFalhas) {
      this.travadoAte = this.now() + this.lockoutMs;
      this.falhas = 0;
    }
  }

  succeed(): void {
    this.falhas = 0;
    this.travadoAte = 0;
  }
}

/**
 * Bloqueia Cross-Site WebSocket Hijacking: navegador sempre manda Origin, e
 * uma pagina de outro dominio nao pode falsifica-lo. Aceita a mesma origem do
 * host ou as listadas em ALLOWED_ORIGINS. Sem Origin (cliente nao-navegador)
 * e aceito: CSWSH e um ataque via navegador da vitima, e o token de
 * dispositivo continua exigido.
 */
export function isOriginAllowed(
  origin: string | undefined,
  host: string | undefined,
  allowed: readonly string[],
): boolean {
  if (!origin) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (allowed.includes(url.origin)) return true;
  return host !== undefined && url.host === host;
}

export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      try {
        return new URL(s).origin;
      } catch {
        return null;
      }
    })
    .filter((s): s is string => s !== null);
}

/**
 * IP do cliente. Atras de proxy (Railway, Render) o socket e o do proxy, e o
 * IP real vem em X-Forwarded-For - mas esse header so e confiavel quando
 * TRUST_PROXY esta ligado, senao qualquer um forja e foge do limite por IP.
 */
export function clientIp(
  socketAddress: string | undefined,
  forwardedFor: string | string[] | undefined,
  trustProxy: boolean,
): string {
  if (trustProxy && forwardedFor) {
    const bruto = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    const primeiro = bruto?.split(',')[0]?.trim();
    if (primeiro) return primeiro;
  }
  return socketAddress ?? 'desconhecido';
}
