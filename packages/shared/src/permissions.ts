import { Permission } from '@concord/types';

/**
 * Permissions are stored as a BigInt bitmask on Role.permissions (Postgres
 * BIGINT). We accept string | bigint | number here because Prisma returns
 * BigInt, JSON payloads carry it as a string, and literals in code are numbers.
 */
export function hasPermission(mask: string | bigint | number, permission: Permission): boolean {
  const bits = BigInt(mask);
  if (bits & BigInt(Permission.ADMINISTRATOR)) return true;
  return (bits & BigInt(permission)) === BigInt(permission);
}

export function combinePermissions(...permissions: Permission[]): bigint {
  return permissions.reduce((acc, p) => acc | BigInt(p), BigInt(0));
}

export function addPermission(mask: string | bigint | number, permission: Permission): bigint {
  return BigInt(mask) | BigInt(permission);
}

export function removePermission(mask: string | bigint | number, permission: Permission): bigint {
  return BigInt(mask) & ~BigInt(permission);
}
