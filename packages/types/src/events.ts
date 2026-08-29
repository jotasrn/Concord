/**
 * Shared Socket.IO event names. Keeping these as const string unions
 * (instead of free-form strings) prevents client/server typos from
 * silently creating dead event channels.
 */
export const MessageEvents = {
  CREATE: 'message:create',
  UPDATE: 'message:update',
  DELETE: 'message:delete',
  REACTION_ADD: 'message:reaction:add',
  REACTION_REMOVE: 'message:reaction:remove',
  TYPING: 'message:typing',
  READ: 'message:read',
} as const;

export const PresenceEvents = {
  UPDATE: 'presence:update',
  SUBSCRIBE: 'presence:subscribe',
} as const;

export const ServerEvents = {
  MEMBER_JOIN: 'server:member:join',
  MEMBER_LEAVE: 'server:member:leave',
  CHANNEL_CREATE: 'server:channel:create',
  CHANNEL_UPDATE: 'server:channel:update',
  CHANNEL_DELETE: 'server:channel:delete',
} as const;

export const VoiceEvents = {
  JOIN: 'voice:join',
  LEAVE: 'voice:leave',
  STATE_UPDATE: 'voice:state:update', // mute/deafen/camera/streaming flags
  PARTICIPANTS: 'voice:participants',
} as const;

/**
 * WebRTC signaling relayed 1:1 through Socket.IO. The signaling server
 * never inspects SDP/ICE payloads, only routes them to the target peer.
 *
 * Note: these mirror the DOM's RTCSessionDescriptionInit/RTCIceCandidateInit
 * shapes but are declared locally so this package doesn't need "dom" in its
 * tsconfig lib (it's compiled for the Node/NestJS side too).
 */
export const SignalingEvents = {
  OFFER: 'rtc:offer',
  ANSWER: 'rtc:answer',
  ICE_CANDIDATE: 'rtc:ice-candidate',
  PEER_JOINED: 'rtc:peer-joined',
  PEER_LEFT: 'rtc:peer-left',
} as const;

export interface RtcSessionDescription {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback';
  sdp: string;
}

export interface RtcIceCandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment?: string | null;
}

export interface RtcOfferPayload {
  targetUserId: string;
  fromUserId: string;
  sdp: RtcSessionDescription;
  channelId: string;
  kind: 'audio' | 'video' | 'screen';
}

export interface RtcAnswerPayload {
  targetUserId: string;
  fromUserId: string;
  sdp: RtcSessionDescription;
  channelId: string;
}

export interface RtcIceCandidatePayload {
  targetUserId: string;
  fromUserId: string;
  candidate: RtcIceCandidate;
}

export interface TypingPayload {
  channelId: string;
  userId: string;
}

export interface VoiceStatePayload {
  channelId: string;
  userId: string;
  muted: boolean;
  deafened: boolean;
  cameraOn: boolean;
  streaming: boolean;
}
