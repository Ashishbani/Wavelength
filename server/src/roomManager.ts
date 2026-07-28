import { randomUUID } from 'node:crypto';
import type { RoomState, PlaybackState, QueueItem, PublicRoomInfo, Member } from '@wavelength/shared';

function makeMember(id: string, name: string, seat?: string): Member {
  return seat ? { id, name, seat } : { id, name };
}

function defaultGenCode(): string {
  return randomUUID().slice(0, 6).toUpperCase();
}

function emptyPlayback(): PlaybackState {
  return { videoId: null, isPlaying: false, positionSec: 0, lastUpdateServerTs: 0 };
}

/** Fields a caller supplies when queueing a track; id + votes are assigned here. */
export type NewQueueItem = Pick<QueueItem, 'videoId' | 'title' | 'addedBy' | 'kind'>;

/** A track that already played, kept so "previous" can go back to it. */
type PlayedTrack = Pick<QueueItem, 'videoId' | 'title' | 'addedBy' | 'kind'>;

export class RoomManager {
  private rooms = new Map<string, RoomState>();
  /** Per-room stack of finished tracks, most recent last. */
  private played = new Map<string, PlayedTrack[]>();
  private static readonly MAX_HISTORY = 50;

  constructor(private genCode: () => string = defaultGenCode) {}

  /** Remember the currently-playing track (if any) before it's replaced. */
  private pushPlayed(room: RoomState): void {
    const pb = room.playback;
    if (!pb.videoId) return;
    const stack = this.played.get(room.code) ?? [];
    stack.push({ videoId: pb.videoId, title: pb.title ?? pb.videoId, addedBy: pb.addedBy ?? '', kind: pb.kind ?? 'yt' });
    if (stack.length > RoomManager.MAX_HISTORY) stack.shift();
    this.played.set(room.code, stack);
  }

  private startTrack(room: RoomState, track: PlayedTrack, serverTs: number): PlaybackState {
    room.playback = {
      videoId: track.videoId,
      kind: track.kind ?? 'yt',
      title: track.title,
      addedBy: track.addedBy,
      isPlaying: true,
      positionSec: 0,
      lastUpdateServerTs: serverTs,
    };
    return room.playback;
  }

  /** True when there's a previously played track to go back to. */
  hasPrevious(code: string): boolean {
    return (this.played.get(code)?.length ?? 0) > 0;
  }

  /**
   * Go back to the last played track. The current track is pushed to the FRONT
   * of the queue so it plays again after this one, mirroring normal player
   * behaviour. Returns null when there's no history.
   */
  previousTrack(code: string, serverTs: number): PlaybackState | null {
    const room = this.requireRoom(code);
    const stack = this.played.get(code);
    const prev = stack?.pop();
    if (!prev) return null;
    const current = room.playback;
    if (current.videoId) {
      room.queue.unshift({
        id: randomUUID(),
        videoId: current.videoId,
        title: current.title ?? current.videoId,
        addedBy: current.addedBy ?? '',
        kind: current.kind ?? 'yt',
        votes: 0,
        voters: [],
      });
    }
    return this.startTrack(room, prev, serverTs);
  }

  /** Jump straight to a queued item, dropping it from the queue. */
  playQueueItem(code: string, itemId: string, serverTs: number): PlaybackState | null {
    const room = this.requireRoom(code);
    const at = room.queue.findIndex((q) => q.id === itemId);
    if (at === -1) return null;
    const [item] = room.queue.splice(at, 1);
    this.pushPlayed(room);
    return this.startTrack(room, item, serverTs);
  }

  createRoom(hostId: string, hostName: string, isPublic = true, seat?: string): RoomState {
    let code = this.genCode();
    while (this.rooms.has(code)) code = this.genCode();
    const state: RoomState = {
      code,
      hostId,
      members: [makeMember(hostId, hostName, seat)],
      queue: [],
      playback: emptyPlayback(),
      isPublic,
    };
    this.rooms.set(code, state);
    return state;
  }

  createRoomWithCode(code: string, hostId: string, hostName: string, isPublic = true, seat?: string): RoomState {
    if (this.rooms.has(code)) throw new Error('CODE_IN_USE');
    const state: RoomState = {
      code,
      hostId,
      members: [makeMember(hostId, hostName, seat)],
      queue: [],
      playback: emptyPlayback(),
      isPublic,
    };
    this.rooms.set(code, state);
    return state;
  }

  joinRoom(code: string, id: string, name: string, seat?: string): RoomState {
    const room = this.rooms.get(code);
    if (!room) throw new Error('ROOM_NOT_FOUND');
    // Never hard-fail on a duplicate name — auto-suffix so joining always works
    // (e.g. two different guests using the same name).
    let finalName = name;
    let n = 2;
    while (room.members.some((m) => m.name.toLowerCase() === finalName.toLowerCase())) {
      finalName = `${name} (${n++})`;
    }
    room.members.push(makeMember(id, finalName, seat));
    // Rejoining an emptied room (or one whose host has left): the joiner hosts.
    if (!room.members.some((m) => m.id === room.hostId)) room.hostId = id;
    return room;
  }

  /** The current member for a seat (account or guest session), if present. */
  memberBySeat(code: string, seat: string): Member | null {
    return this.rooms.get(code)?.members.find((m) => m.seat === seat) ?? null;
  }

  setHost(code: string, id: string): void {
    const room = this.rooms.get(code);
    if (room && room.members.some((m) => m.id === id)) room.hostId = id;
  }

  // Removes a member. Does NOT delete an emptied room — the caller keeps it for a
  // short grace period (so a refresh/reconnect can rejoin) and calls deleteRoom.
  leaveRoom(id: string): { code: string; state: RoomState; empty: boolean } | null {
    for (const room of this.rooms.values()) {
      const idx = room.members.findIndex((m) => m.id === id);
      if (idx === -1) continue;
      room.members.splice(idx, 1);
      if (room.hostId === id && room.members.length > 0) room.hostId = room.members[0].id;
      return { code: room.code, state: room, empty: room.members.length === 0 };
    }
    return null;
  }

  deleteRoom(code: string): void {
    this.rooms.delete(code);
    this.played.delete(code);
  }

  addToQueue(code: string, item: NewQueueItem): RoomState {
    const room = this.requireRoom(code);
    room.queue.push({ id: randomUUID(), votes: 0, voters: [], ...item });
    return room;
  }

  /** Toggle a member's upvote (one vote per seat) and keep the queue ordered
      by votes (desc, stable). */
  voteQueueItem(code: string, itemId: string, voter: string): RoomState {
    const room = this.requireRoom(code);
    const item = room.queue.find((q) => q.id === itemId);
    if (item) {
      const voters = item.voters ?? (item.voters = []);
      const at = voters.indexOf(voter);
      if (at === -1) voters.push(voter); else voters.splice(at, 1);
      item.votes = voters.length;
      // Stable sort: higher votes first, otherwise preserve insertion order.
      room.queue = room.queue
        .map((q, i) => ({ q, i }))
        .sort((a, b) => b.q.votes - a.q.votes || a.i - b.i)
        .map((x) => x.q);
    }
    return room;
  }

  removeQueueItem(code: string, itemId: string): RoomState {
    const room = this.requireRoom(code);
    room.queue = room.queue.filter((q) => q.id !== itemId);
    return room;
  }

  /** Move a queued item to the front ("play next"). */
  moveToFront(code: string, itemId: string): RoomState {
    const room = this.requireRoom(code);
    const at = room.queue.findIndex((q) => q.id === itemId);
    if (at > 0) room.queue.unshift(room.queue.splice(at, 1)[0]);
    return room;
  }

  advanceQueue(code: string, serverTs: number): PlaybackState {
    const room = this.requireRoom(code);
    const next = room.queue.shift();
    this.pushPlayed(room); // remember what just played so "previous" can return
    if (!next) {
      room.playback = { ...emptyPlayback(), lastUpdateServerTs: serverTs };
      return room.playback;
    }
    return this.startTrack(room, next, serverTs);
  }

  setPlayback(
    code: string,
    patch: { isPlaying?: boolean; positionSec: number },
    serverTs: number,
  ): PlaybackState {
    const room = this.requireRoom(code);
    room.playback = {
      ...room.playback,
      positionSec: patch.positionSec,
      isPlaying: patch.isPlaying ?? room.playback.isPlaying,
      lastUpdateServerTs: serverTs,
    };
    return room.playback;
  }

  getRoom(code: string): RoomState | null {
    return this.rooms.get(code) ?? null;
  }

  getRoomByMember(id: string): RoomState | null {
    for (const room of this.rooms.values()) {
      if (room.members.some((m) => m.id === id)) return room;
    }
    return null;
  }

  isHost(code: string, id: string): boolean {
    return this.rooms.get(code)?.hostId === id;
  }

  /** Public, occupied rooms for the lobby discovery grid, busiest first. */
  listPublicRooms(): PublicRoomInfo[] {
    return [...this.rooms.values()]
      .filter((r) => r.isPublic && r.members.length > 0)
      .map((r) => ({
        code: r.code,
        name: this.roomLabel(r),
        memberCount: r.members.length,
        nowPlaying: !!r.playback.videoId && r.playback.isPlaying,
      }))
      .sort((a, b) => b.memberCount - a.memberCount);
  }

  private roomLabel(room: RoomState): string {
    const host = room.members.find((m) => m.id === room.hostId);
    return host ? `${host.name}'s room` : `Room ${room.code}`;
  }

  private requireRoom(code: string): RoomState {
    const room = this.rooms.get(code);
    if (!room) throw new Error('ROOM_NOT_FOUND');
    return room;
  }
}
