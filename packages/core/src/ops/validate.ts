import { OpType } from './types';

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
} as const;

function isString(value: unknown, max: number): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function isOptionalString(value: unknown, max: number): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.length <= max);
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

const VALIDATORS: Record<OpType, Validator> = {
  'server.create': (p) =>
    isString(p.serverId, LIMITS.ID) &&
    isString(p.name, LIMITS.NAME) &&
    isOptionalString(p.icon, LIMITS.ICON) &&
    isString(p.ownerDisplayName, LIMITS.NAME),

  'server.update': (p) =>
    (p.name === undefined || isString(p.name, LIMITS.NAME)) &&
    (p.icon === undefined || isOptionalString(p.icon, LIMITS.ICON)),

  'member.join': (p) =>
    isPublicKey(p.userKey) &&
    isString(p.displayName, LIMITS.NAME) &&
    isOptionalString(p.inviteCode, LIMITS.INVITE_CODE),

  'member.role': (p) => isPublicKey(p.userKey) && isPermissionMask(p.permissions),

  'channel.create': (p) =>
    isString(p.channelId, LIMITS.ID) &&
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
