export enum UserStatus {
  ONLINE = 'ONLINE',
  IDLE = 'IDLE',
  DND = 'DND',
  INVISIBLE = 'INVISIBLE',
  OFFLINE = 'OFFLINE',
}

export enum ChannelType {
  TEXT = 'TEXT',
  VOICE = 'VOICE',
}

export enum FriendshipStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
}

/**
 * Bitwise permission flags, mirrors Prisma Role.permissions (BigInt).
 * Combine with bitwise OR; check with bitwise AND.
 */
export enum Permission {
  VIEW_CHANNEL = 1 << 0,
  SEND_MESSAGES = 1 << 1,
  CONNECT = 1 << 2,
  SPEAK = 1 << 3,
  STREAM = 1 << 4,
  MANAGE_CHANNELS = 1 << 5,
  MANAGE_SERVER = 1 << 6,
  MANAGE_MEMBERS = 1 << 7,
  BAN_MEMBERS = 1 << 8,
  KICK_MEMBERS = 1 << 9,
  ADMINISTRATOR = 1 << 10,
}

export const DEFAULT_MEMBER_PERMISSIONS =
  Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES | Permission.CONNECT | Permission.SPEAK;

export const DEFAULT_ADMIN_PERMISSIONS = Permission.ADMINISTRATOR;
