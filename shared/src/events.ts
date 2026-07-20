export interface Member {
  id: string;
  name: string;
  /** Dedup key: account id if signed in, else a per-tab guest session id.
      Used to enforce one seat per account/session (take over duplicate tabs). */
  seat?: string;
}

export interface QueueItem {
  id: string;
  videoId: string;
  title: string;
  addedBy: string;
  votes: number;
}

export interface PlaybackState {
  videoId: string | null;
  isPlaying: boolean;
  positionSec: number;
  lastUpdateServerTs: number;
}

export interface RoomState {
  code: string;
  hostId: string;
  members: Member[];
  queue: QueueItem[];
  playback: PlaybackState;
  isPublic: boolean;
}

export interface ChatMessage {
  name: string;
  text: string;
  ts: number;
}

export interface PresenceInfo {
  userId: string;
  online: boolean;
  roomCode: string | null;
}

/** A live, public room as shown on the lobby "Explore" grid. */
export interface PublicRoomInfo {
  code: string;
  name: string;
  memberCount: number;
  nowPlaying: boolean;
}

export type CreateJoinResult =
  | { ok: true; state: RoomState; selfId: string }
  | { ok: false; error: string };

export interface ClientToServerEvents {
  'room:create': (payload: { name: string; isPublic?: boolean; clientId?: string }, cb: (res: CreateJoinResult) => void) => void;
  'room:join': (payload: { code: string; name: string; clientId?: string }, cb: (res: CreateJoinResult) => void) => void;
  'room:leave': () => void;
  'playback:play': (payload: { positionSec: number }) => void;
  'playback:pause': (payload: { positionSec: number }) => void;
  'playback:seek': (payload: { positionSec: number }) => void;
  'playback:heartbeat': (payload: { positionSec: number }) => void;
  'queue:add': (payload: { videoId: string; title: string }) => void;
  'queue:next': () => void;
  'queue:vote': (payload: { itemId: string }) => void;
  'queue:loadPlaylist': (payload: { playlistId: string }) => void;
  'chat:send': (payload: { text: string }) => void;
  'lobby:subscribe': () => void;
  'lobby:unsubscribe': () => void;
  'time:ping': (payload: { t0: number }, cb: (res: { t0: number; serverTime: number }) => void) => void;
  'whoami': (cb: (res: { userId: string | null }) => void) => void;
  'invite:send': (payload: { toUserId: string }) => void;
}

export interface ServerToClientEvents {
  'room:state': (state: RoomState) => void;
  'playback:update': (playback: PlaybackState) => void;
  'playback:sync': (playback: PlaybackState) => void;
  'chat:message': (msg: ChatMessage) => void;
  'session:superseded': () => void;
  'lobby:rooms': (payload: { rooms: PublicRoomInfo[] }) => void;
  'presence:snapshot': (payload: { friends: PresenceInfo[] }) => void;
  'presence:update': (payload: PresenceInfo) => void;
  'friend:requestReceived': (payload: { fromUsername: string; fromDisplayName: string }) => void;
  'invite:receive': (payload: { fromDisplayName: string; code: string; roomName: string | null }) => void;
}
