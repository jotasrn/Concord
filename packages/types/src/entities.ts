import { ChannelType, FriendshipStatus, UserStatus } from './enums';

export interface User {
  id: string;
  username: string;
  displayName: string;
  email: string;
  avatar: string | null;
  banner: string | null;
  bio: string | null;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

export type PublicUser = Pick<User, 'id' | 'username' | 'displayName' | 'avatar' | 'status'>;

export interface ConcordServer {
  id: string;
  name: string;
  icon: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServerMember {
  id: string;
  serverId: string;
  userId: string;
  nickname: string | null;
  roleIds: string[];
  joinedAt: string;
}

export interface Role {
  id: string;
  serverId: string;
  name: string;
  color: string | null;
  position: number;
  permissions: string; // BigInt serialized as string
}

export interface Category {
  id: string;
  serverId: string;
  name: string;
  position: number;
}

export interface Channel {
  id: string;
  serverId: string;
  categoryId: string | null;
  name: string;
  type: ChannelType;
  topic: string | null;
  position: number;
}

export interface Message {
  id: string;
  channelId: string;
  authorId: string;
  content: string;
  replyToId: string | null;
  editedAt: string | null;
  createdAt: string;
}

export interface MessageReaction {
  id: string;
  messageId: string;
  userId: string;
  emoji: string;
}

export interface Invite {
  id: string;
  code: string;
  serverId: string;
  createdById: string;
  maxUses: number | null;
  uses: number;
  expiresAt: string | null;
  createdAt: string;
}

export interface DirectMessage {
  id: string;
  senderId: string;
  recipientId: string;
  content: string;
  createdAt: string;
  editedAt: string | null;
}

export interface Friendship {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: FriendshipStatus;
  createdAt: string;
}

export interface VoiceSession {
  id: string;
  channelId: string;
  userId: string;
  joinedAt: string;
  leftAt: string | null;
  muted: boolean;
  deafened: boolean;
  streaming: boolean;
  cameraOn: boolean;
}
