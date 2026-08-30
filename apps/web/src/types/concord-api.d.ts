export interface ServerView {
  id: string;
  name: string;
  icon: string | null;
  ownerKey: string;
}

export interface ChannelView {
  id: string;
  serverId: string;
  name: string;
  type: 'TEXT' | 'VOICE';
  topic: string | null;
  position: number;
}

export interface MessageView {
  id: string;
  channelId: string;
  authorKey: string;
  authorName: string;
  content: string;
  replyToId: string | null;
  createdAt: number;
  editedAt: number | null;
}

export interface MemberView {
  userKey: string;
  displayName: string;
  permissions: string;
  avatar: string | null;
  bio: string | null;
}

/**
 * OFFLINE nao e um status que se escolhe: ele e derivado da ausencia de
 * conexao com o peer. Por isso presence.set aceita apenas os demais.
 */
export type PresenceStatus = 'ONLINE' | 'IDLE' | 'DND' | 'INVISIBLE' | 'OFFLINE';
export type SettableStatus = Exclude<PresenceStatus, 'OFFLINE'>;

export interface PeerPresence {
  status: string;
  /** Canal de voz em que o peer esta, ou null. */
  voice: string | null;
}

export interface UserProfile {
  userKey: string;
  displayName: string;
  avatar: string | null;
  bio: string | null;
}

export interface Profile {
  displayName: string;
  publicKey: string;
  handle: string;
}

export interface ConcordApi {
  account: {
    status(): Promise<{ hasAccount: boolean; unlocked: boolean; displayName: string | null }>;
    newPhrase(): Promise<string>;
    create(displayName: string, password: string, phrase: string): Promise<boolean>;
    restore(displayName: string, password: string, phrase: string): Promise<boolean>;
    unlock(password: string): Promise<Profile>;
    profile(): Promise<Profile>;
  };
  servers: {
    list(): Promise<ServerView[]>;
    create(name: string): Promise<string>;
    join(serverId: string): Promise<boolean>;
  };
  members: {
    list(serverId: string): Promise<MemberView[]>;
    add(serverId: string, userKey: string, displayName: string): Promise<boolean>;
  };
  channels: {
    list(serverId: string): Promise<ChannelView[]>;
    create(serverId: string, name: string, type: 'TEXT' | 'VOICE'): Promise<string>;
  };
  messages: {
    list(channelId: string, limit?: number): Promise<MessageView[]>;
    send(serverId: string, channelId: string, content: string): Promise<string>;
    remove(serverId: string, messageId: string): Promise<boolean>;
  };
  voice: {
    signal(serverId: string, signal: unknown): Promise<boolean>;
    onSignal(handler: (serverId: string, signal: any) => void): () => void;
  };
  profile: {
    update(profile: { displayName: string; avatar: string | null; bio: string | null }): Promise<boolean>;
    get(userKey: string): Promise<UserProfile | null>;
  };
  presence: {
    set(status: SettableStatus): Promise<boolean>;
    get(): Promise<{ status: string; peers: Record<string, PeerPresence> }>;
    setVoiceChannel(channelId: string | null): Promise<boolean>;
    onUpdate(handler: (peers: Record<string, PeerPresence>) => void): () => void;
  };
  screen: {
    sources(): Promise<
      {
        id: string;
        name: string;
        kind: 'screen' | 'window';
        thumbnail: string;
        appIcon: string | null;
      }[]
    >;
  };
  invites: {
    create(serverId: string): Promise<string>;
    accept(code: string): Promise<string>;
  };
  network: {
    status(): Promise<{ peers: number; online: boolean }>;
  };
  onSyncUpdate(handler: (serverId: string) => void): () => void;
}

declare global {
  interface Window {
    concord: ConcordApi;
  }
}
