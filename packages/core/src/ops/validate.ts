import { Operation, OpType } from './types';
import { isValidNonce } from './selfCert';

/**
 * Validacao de payloads vindos da rede.
 *
 * O reducer antes fazia `op.payload as MessageCreatePayload` - um cast, que
 * nao verifica nada em runtime. Um peer com identidade valida podia mandar
 * `payload: null` e derrubar o processo de todos os outros, ou uma mensagem de
 * 2 MB e enche-los de lixo. Aqui cada tipo de operacao declara o formato que
 * aceita, e o que nao encaixa e descartado.
 */

export const LIMITS = {
  CONTENT: 4000,
  NAME: 64,
  TOPIC: 512,
  ID: 128,
  PUBLIC_KEY_HEX: 64,
  ICON: 2048,
  INVITE_CODE: 64,
  BIO: 300,
  /**
   * Teto do avatar em caracteres de data URL. Cada troca de foto reescreve
   * essa string no log de todos os peers, entao o limite e apertado de
   * proposito - 128x128 em JPEG cabe folgado.
   */
  AVATAR: 48_000,
} as const;

function isString(value: unknown, max: number): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function isOptionalString(value: unknown, max: number): boolean {
  return (
    value === null || value === undefined || (typeof value === 'string' && value.length <= max)
  );
}

function isPublicKey(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/** Bitmask de permissoes: string decimal nao negativa. */
function isPermissionMask(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) return false;
  try {
    return BigInt(value) >= BigInt(0);
  } catch {
    return false;
  }
}

type Validator = (p: Record<string, unknown>) => boolean;

/**
 * Aceita apenas data URL de imagem em base64.
 *
 * Sem esta checagem um peer poderia mandar `javascript:` ou uma URL remota no
 * campo de avatar, e a interface renderizaria isso como origem de imagem.
 */
function isDataUrlImage(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.length <= LIMITS.AVATAR &&
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  );
}

const VALIDATORS: Record<OpType, Validator> = {
  'server.create': (p) =>
    isString(p.serverId, LIMITS.ID) &&
    isValidNonce(p.nonce) &&
    isString(p.name, LIMITS.NAME) &&
    isOptionalString(p.icon, LIMITS.ICON) &&
    isString(p.ownerDisplayName, LIMITS.NAME),

  'server.update': (p) =>
    (p.name === undefined || isString(p.name, LIMITS.NAME)) &&
    (p.icon === undefined || isOptionalString(p.icon, LIMITS.ICON)),

  'user.profile': (p) =>
    isString(p.displayName, LIMITS.NAME) &&
    (p.avatar === null || isDataUrlImage(p.avatar)) &&
    (p.bio === null || isString(p.bio, LIMITS.BIO)),

  'member.join': (p) =>
    isPublicKey(p.userKey) &&
    isString(p.displayName, LIMITS.NAME) &&
    isOptionalString(p.inviteCode, LIMITS.INVITE_CODE),

  'member.role': (p) =>
    isPublicKey(p.userKey) &&
    isPermissionMask(p.permissions) &&
    (p.roleName === undefined || isString(p.roleName, LIMITS.NAME)),

  'member.nick': (p) =>
    isPublicKey(p.userKey) && (p.nickname === null || isString(p.nickname, LIMITS.NAME)),

  'member.kick': (p) =>
    isPublicKey(p.userKey) && (p.reason === null || isOptionalString(p.reason, LIMITS.TOPIC)),

  'member.mute': (p) => isPublicKey(p.userKey) && typeof p.muted === 'boolean',

  'channel.create': (p) =>
    isString(p.channelId, LIMITS.ID) &&
    isValidNonce(p.nonce) &&
    isString(p.name, LIMITS.NAME) &&
    (p.type === 'TEXT' || p.type === 'VOICE') &&
    isOptionalString(p.categoryId, LIMITS.ID) &&
    isInteger(p.position),

  'channel.update': (p) =>
    isString(p.channelId, LIMITS.ID) &&
    (p.name === undefined || isString(p.name, LIMITS.NAME)) &&
    (p.topic === undefined || isOptionalString(p.topic, LIMITS.TOPIC)) &&
    (p.position === undefined || isInteger(p.position)),

  'channel.delete': (p) => isString(p.channelId, LIMITS.ID),

  'message.create': (p) =>
    isString(p.messageId, LIMITS.ID) &&
    isString(p.channelId, LIMITS.ID) &&
    isString(p.content, LIMITS.CONTENT) &&
    isOptionalString(p.replyToId, LIMITS.ID),

  'message.edit': (p) => isString(p.messageId, LIMITS.ID) && isString(p.content, LIMITS.CONTENT),

  'message.delete': (p) => isString(p.messageId, LIMITS.ID),
};

/** Devolve null quando o payload e aceitavel, ou o motivo da recusa. */
export function validatePayload(type: OpType, payload: unknown): string | null {
  const validator = VALIDATORS[type];
  if (!validator) return `tipo desconhecido: ${type}`;

  // Precisa ser objeto simples: null, array e primitivo sao recusados antes de
  // qualquer acesso a propriedade.
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return 'payload nao e um objeto';
  }

  return validator(payload as Record<string, unknown>) ? null : 'payload fora do formato esperado';
}

/**
 * Teto para `seq` e `lamport`. Nao ha operacao legitima perto disso - serve
 * so para rejeitar valores absurdos antes que cheguem a aritmetica do
 * `compareOperations` (onde subtracao de numeros extremos pode perder
 * precisao ou estourar).
 */
const MAX_COUNTER = 2 ** 31;

/** Inteiro seguro, nao negativo e dentro do teto. */
function isSaneCounter(value: unknown): boolean {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < MAX_COUNTER
  );
}

/**
 * `timestamp` e Date.now() - milissegundos desde 1970 - entao precisa de um
 * teto bem maior que seq/lamport (hoje ja passa de 1.7 trilhao). So descarta
 * o obviamente absurdo: negativo, fracionario ou de um futuro distante.
 */
const MAX_TIMESTAMP = 4_102_444_800_000; // ano 2100
function isSaneTimestamp(value: unknown): boolean {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < MAX_TIMESTAMP
  );
}

/**
 * Forma minima que QUALQUER operacao precisa ter, antes mesmo de olhar o
 * payload especifico do tipo.
 *
 * O campo que faltava checar era exatamente o que decide a ordem de replay:
 * `lamport` e `seq` nunca eram validados, e a ordem (lamport, authorKey, seq)
 * e o unico criterio de "quem veio primeiro" no log. Uma operacao com
 * `lamport: -1` sempre replayava antes de qualquer coisa legitima - e e assim
 * que um server.create forjado tomava um servidor existente (reducer.ts
 * so confere "ja existe", e quem e aplicado primeiro decide quem e o dono).
 *
 * Isto sozinho nao fecha a corrida por completo (ver `selfCert.ts` para o que
 * fecha de verdade no caso de server.create e channel.create), mas elimina a
 * forma mais barata de ataque: valores negativos ou fora de qualquer faixa
 * plausivel.
 */
export function isWellFormedOperation(op: Operation): boolean {
  return (
    isSaneCounter(op.seq) &&
    isSaneCounter(op.lamport) &&
    isSaneTimestamp(op.timestamp) &&
    isPublicKey(op.authorKey) &&
    isString(op.serverId, LIMITS.ID) &&
    typeof op.id === 'string' &&
    /^[0-9a-f]{64}$/.test(op.id) &&
    typeof op.signature === 'string' &&
    /^[0-9a-f]{128}$/.test(op.signature)
  );
}
