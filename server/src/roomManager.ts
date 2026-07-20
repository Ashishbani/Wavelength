import { randomUUID } from 'node:crypto';
import type { RoomState, PlaybackState, QueueItem, PublicRoomInfo } from '@wavelength/shared';

function defaultGenCode(): string {
  return randomUUID().slice(0, 6).toUpperCase();
}

function emptyPlayback(): PlaybackState {
  return { videoId: null, isPlaying: false, positionSec: 0, lastUpdateServerTs: 0 };
}

/** Fields a caller supplies when queueing a track; id + votes are assigned here. */
export type NewQueueItem = Pick<QueueItem, 'videoId' | 'title' | 'addedBy'>;

export class RoomManager {
  private rooms = new Map<string, RoomState>();

  constructor(private genCode: () => string = defaultGenCode) {}

  createRoom(hostId: string, hostName: string, isPublic = true): RoomState {
    let code = this.genCode();
    while (this.rooms.has(code)) code = this.genCode();
    const state: RoomState = {
      code,
      hostId,
      members: [{ id: hostId, name: hostName }],
      queue: [],
      playback: emptyPlayback(),
      isPublic,
    };
    this.rooms.set(code, state);
    return state;
  }

  createRoomWithCode(code: string, hostId: string, hostName: string, isPublic = true): RoomState {
    if (this.rooms.has(code)) throw new Error('CODE_IN_USE');
    const state: RoomState = {
      code,
      hostId,
      members: [{ id: hostId, name: hostName }],
      queue: [],
      playback: emptyPlayback(),
      isPublic,
    };
    this.rooms.set(code, state);
    return state;
  }

  joinRoom(code: string, id: string, name: string): RoomState {
    const room = this.rooms.get(code);
    if (!room) throw new Error('ROOM_NOT_FOUND');
    // Never hard-fail on a duplicate name — auto-suffix so joining always works
    // (e.g. opening your own room from Explore in a second tab).
    let finalName = name;
    let n = 2;
    while (room.members.some((m) => m.name.toLowerCase() === finalName.toLowerCase())) {
      finalName = `${name} (${n++})`;
    }
    room.members.push({ id, name: finalName });
    // Rejoining an emptied room (or one whose host has left): the joiner hosts.
    if (!room.members.some((m) => m.id === room.hostId)) room.hostId = id;
    return room;
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
  }

  addToQueue(code: string, item: NewQueueItem): RoomState {
    const room = this.requireRoom(code);
    room.queue.push({ id: randomUUID(), votes: 0, ...item });
    return room;
  }

  /** Upvote a queued item and keep the queue ordered by votes (desc, stable). */
  voteQueueItem(code: string, itemId: string): RoomState {
    const room = this.requireRoom(code);
    const item = room.queue.find((q) => q.id === itemId);
    if (item) {
      item.votes += 1;
      // Stable sort: higher votes first, otherwise preserve insertion order.
      room.queue = room.queue
        .map((q, i) => ({ q, i }))
        .sort((a, b) => b.q.votes - a.q.votes || a.i - b.i)
        .map((x) => x.q);
    }
    return room;
  }

  advanceQueue(code: string, serverTs: number): PlaybackState {
    const room = this.requireRoom(code);
    const next = room.queue.shift();
    room.playback = next
      ? { videoId: next.videoId, isPlaying: true, positionSec: 0, lastUpdateServerTs: serverTs }
      : { ...emptyPlayback(), lastUpdateServerTs: serverTs };
    return room.playback;
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
