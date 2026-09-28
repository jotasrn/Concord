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
  nickname: string | null;
  profileName: string;
  permissions: string;
  roleName: string | null;
  muted: boolean;
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

export interface Friend {
  userKey: string;
  displayName: string;
  avatar: string | null;
  state: 'PENDING_IN' | 'PENDING_OUT' | 'ACCEPTED';
  createdAt: number;
}

export interface PendingInvite {
  serverId: string;
  serverName: string;
  fromKey: string;
  code: string;
  createdAt: number;
}

export interface ResourceSettings {
  maxHeapMb: number | null;
  maxCores: number | null;
  maxStorageMb: number | null;
  runInBackground: boolean;
  startWithSystem: boolean;
}

export interface VideoSettings {
  cameraDeviceId: string | null;
  cameraHeight: number;
  cameraFrameRate: number;
  screenPresetId: string;
}

export interface AppSettings {
  resources: ResourceSettings;
  video: VideoSettings;
}

export interface MachineResources {
  cores: number;
  totalMemoryMb: number;
}

export interface StorageUsage {
  operations: number;
  messages: number;
  avatarBytes: number;
  diskBytes: number;
}

export interface UserProfile {
  userKey: string;
  displayName: string;
  avatar: string | null;
  bio: string | null;
}

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'unsupported' | 'error';
  version: string | null;
  percent: number;
  message: string | null;
  /** Atualizacao baixada, mas represada porque ha chamada em andamento. */
  waitingForCall: boolean;
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
    nick(serverId: string, userKey: string, nickname: string | null): Promise<boolean>;
    role(serverId: string, userKey: string, permissions: string, roleName: string): Promise<boolean>;
    mute(serverId: string, userKey: string, muted: boolean): Promise<boolean>;
    kick(serverId: string, userKey: string): Promise<boolean>;
    roles(): Promise<{
      presets: { id: string; label: string; description: string; permissions: string }[];
      permissions: { flag: string; label: string; hint: string }[];
    }>;
    add(serverId: string, userKey: string, displayName: string): Promise<'entregue' | 'na-fila'>;
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
  friends: {
    list(): Promise<Friend[]>;
    request(targetKey: string): Promise<'entregue' | 'na-fila'>;
    respond(targetKey: string, accepted: boolean): Promise<boolean>;
    remove(targetKey: string): Promise<boolean>;
  };
  serverInvites: {
    pending(): Promise<PendingInvite[]>;
    send(serverId: string, targetKey: string): Promise<'entregue' | 'na-fila'>;
    accept(serverId: string): Promise<string>;
    decline(serverId: string): Promise<boolean>;
  };
  onSocialEvent(handler: (evento: string, dados: any) => void): () => void;
  calls: {
    invite(targetKey: string, callId: string): Promise<'entregue' | 'na-fila'>;
    respond(targetKey: string, callId: string, accepted: boolean): Promise<boolean>;
    end(targetKey: string, callId: string): Promise<boolean>;
    signal(targetKey: string, signal: unknown): Promise<boolean>;
    onSignal(handler: (callId: string, signal: any) => void): () => void;
  };
  overlay: {
    update(
      participants: {
        key: string;
        name: string;
        avatar: string | null;
        speaking: boolean;
        muted: boolean;
      }[],
      visivel: boolean,
    ): Promise<boolean>;
    hide(): Promise<boolean>;
  };
  settings: {
    get(): Promise<{ settings: AppSettings; machine: MachineResources }>;
    save(settings: AppSettings): Promise<boolean>;
    usage(): Promise<StorageUsage>;
    prune(olderThanDays: number): Promise<{ removed: number }>;
    setCallActive(active: boolean): Promise<boolean>;
  };
  update: {
    status(): Promise<UpdateStatus>;
    check(): Promise<UpdateStatus>;
    install(): Promise<{ ok: boolean; motivo?: string }>;
    onStatus(handler: (status: UpdateStatus) => void): () => void;
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
  app: {
    version(): Promise<string>;
  };
  onSyncUpdate(handler: (serverId: string) => void): () => void;
}

declare global {
  interface Window {
    concord: ConcordApi;
  }
}
