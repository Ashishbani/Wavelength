export interface Member {
  id: string;
  name: string;
}

export interface QueueItem {
  videoId: string;
  title: string;
  addedBy: string;
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
}

export interface ChatMessage {
  name: string;
  text: string;
  ts: number;
}

export type CreateJoinResult =
  | { ok: true; state: RoomState; selfId: string }
  | { ok: false; error: string };

export interface ClientToServerEvents {
  'room:create': (payload: { name: string }, cb: (res: CreateJoinResult) => void) => void;
  'room:join': (payload: { code: string; name: string }, cb: (res: CreateJoinResult) => void) => void;
  'playback:play': (payload: { positionSec: number }) => void;
  'playback:pause': (payload: { positionSec: number }) => void;
  'playback:seek': (payload: { positionSec: number }) => void;
  'playback:heartbeat': (payload: { positionSec: number }) => void;
  'queue:add': (payload: { videoId: string; title: string }) => void;
  'queue:next': () => void;
  'chat:send': (payload: { text: string }) => void;
  'time:ping': (payload: { t0: number }, cb: (res: { t0: number; serverTime: number }) => void) => void;
}

export interface ServerToClientEvents {
  'room:state': (state: RoomState) => void;
  'playback:update': (playback: PlaybackState) => void;
  'chat:message': (msg: ChatMessage) => void;
}
