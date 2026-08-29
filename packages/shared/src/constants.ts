export const MESSAGE_MAX_LENGTH = 4000;
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
export const SERVER_NAME_MAX_LENGTH = 64;
export const CHANNEL_NAME_MAX_LENGTH = 64;
export const MESSAGE_PAGE_SIZE = 50;
export const INVITE_CODE_LENGTH = 8;

export const RATE_LIMITS = {
  MESSAGES_PER_MINUTE: 30,
  AUTH_ATTEMPTS_PER_15_MIN: 10,
} as const;
