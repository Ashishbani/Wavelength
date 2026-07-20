import { describe, it, expect, beforeEach } from 'vitest';
import { RoomManager } from './roomManager.js';

describe('RoomManager', () => {
  let mgr: RoomManager;
  beforeEach(() => {
    // deterministic codes for tests
    let n = 0;
    mgr = new RoomManager(() => `ROOM${n++}`);
  });

  it('creates a room with the creator as host and sole member', () => {
    const state = mgr.createRoom('h1', 'Alice');
    expect(state.code).toBe('ROOM0');
    expect(state.hostId).toBe('h1');
    expect(state.members).toEqual([{ id: 'h1', name: 'Alice' }]);
    expect(state.playback.videoId).toBeNull();
  });

  it('lets a second person join', () => {
    mgr.createRoom('h1', 'Alice');
    const state = mgr.joinRoom('ROOM0', 'u2', 'Bob');
    expect(state.members).toHaveLength(2);
  });

  it('rejects joining an unknown room', () => {
    expect(() => mgr.joinRoom('NOPE', 'u2', 'Bob')).toThrow('ROOM_NOT_FOUND');
  });

  it('auto-suffixes a duplicate name instead of rejecting', () => {
    mgr.createRoom('h1', 'Alice');
    const state = mgr.joinRoom('ROOM0', 'u2', 'Alice');
    expect(state.members.map((m) => m.name)).toEqual(['Alice', 'Alice (2)']);
  });

  it('promotes the next member to host when the host leaves', () => {
    mgr.createRoom('h1', 'Alice');
    mgr.joinRoom('ROOM0', 'u2', 'Bob');
    const res = mgr.leaveRoom('h1');
    expect(res?.state?.hostId).toBe('u2');
    expect(res?.state?.members).toHaveLength(1);
  });

  it('keeps an emptied room until deleteRoom (grace period)', () => {
    mgr.createRoom('h1', 'Alice');
    const res = mgr.leaveRoom('h1');
    expect(res?.empty).toBe(true);
    expect(mgr.getRoom('ROOM0')).not.toBeNull();
    mgr.deleteRoom('ROOM0');
    expect(mgr.getRoom('ROOM0')).toBeNull();
  });

  it('makes the joiner the host when rejoining an emptied room', () => {
    mgr.createRoom('h1', 'Alice');
    mgr.leaveRoom('h1'); // emptied but kept
    const state = mgr.joinRoom('ROOM0', 'u2', 'Bob');
    expect(state.hostId).toBe('u2');
    expect(state.members).toEqual([{ id: 'u2', name: 'Bob' }]);
  });

  it('appends to the queue', () => {
    mgr.createRoom('h1', 'Alice');
    const state = mgr.addToQueue('ROOM0', { videoId: 'dQw4w9WgXcQ', title: 'Song', addedBy: 'Alice' });
    expect(state.queue).toHaveLength(1);
  });

  it('advances the queue and stamps playback', () => {
    mgr.createRoom('h1', 'Alice');
    mgr.addToQueue('ROOM0', { videoId: 'dQw4w9WgXcQ', title: 'Song', addedBy: 'Alice' });
    const pb = mgr.advanceQueue('ROOM0', 5000);
    expect(pb.videoId).toBe('dQw4w9WgXcQ');
    expect(pb.isPlaying).toBe(true);
    expect(pb.positionSec).toBe(0);
    expect(pb.lastUpdateServerTs).toBe(5000);
  });

  it('advancing an empty queue stops playback', () => {
    mgr.createRoom('h1', 'Alice');
    const pb = mgr.advanceQueue('ROOM0', 5000);
    expect(pb.videoId).toBeNull();
    expect(pb.isPlaying).toBe(false);
  });

  it('setPlayback stamps position and time', () => {
    mgr.createRoom('h1', 'Alice');
    mgr.addToQueue('ROOM0', { videoId: 'dQw4w9WgXcQ', title: 'Song', addedBy: 'Alice' });
    mgr.advanceQueue('ROOM0', 1000);
    const pb = mgr.setPlayback('ROOM0', { isPlaying: false, positionSec: 30 }, 8000);
    expect(pb.isPlaying).toBe(false);
    expect(pb.positionSec).toBe(30);
    expect(pb.lastUpdateServerTs).toBe(8000);
  });

  it('isHost reflects the current host', () => {
    mgr.createRoom('h1', 'Alice');
    mgr.joinRoom('ROOM0', 'u2', 'Bob');
    expect(mgr.isHost('ROOM0', 'h1')).toBe(true);
    expect(mgr.isHost('ROOM0', 'u2')).toBe(false);
  });

  it('creates a live room with a specific code', () => {
    const state = mgr.createRoomWithCode('ABC123', 'h1', 'Alice');
    expect(state.code).toBe('ABC123');
    expect(state.hostId).toBe('h1');
    expect(mgr.getRoom('ABC123')?.members).toHaveLength(1);
  });

  it('throws if the code is already live', () => {
    mgr.createRoomWithCode('ABC123', 'h1', 'Alice');
    expect(() => mgr.createRoomWithCode('ABC123', 'h2', 'Bob')).toThrow('CODE_IN_USE');
  });

  it('assigns ids and votes to queued items', () => {
    mgr.createRoom('h1', 'Alice');
    const state = mgr.addToQueue('ROOM0', { videoId: 'dQw4w9WgXcQ', title: 'A', addedBy: 'Alice' });
    expect(state.queue[0].id).toBeTruthy();
    expect(state.queue[0].votes).toBe(0);
  });

  it('upvotes a queued item and reorders by votes', () => {
    mgr.createRoom('h1', 'Alice');
    mgr.addToQueue('ROOM0', { videoId: 'dQw4w9WgXcQ', title: 'A', addedBy: 'Alice' });
    mgr.addToQueue('ROOM0', { videoId: 'oHg5SJYRHA0', title: 'B', addedBy: 'Bob' });
    const bId = mgr.getRoom('ROOM0')!.queue[1].id;
    const after = mgr.voteQueueItem('ROOM0', bId);
    expect(after.queue[0].title).toBe('B');
    expect(after.queue[0].votes).toBe(1);
  });

  it('lists public occupied rooms busiest first and excludes private ones', () => {
    mgr.createRoom('h1', 'Alice');          // ROOM0 public, 1
    mgr.createRoom('h2', 'Bob');            // ROOM1 public, 1
    mgr.joinRoom('ROOM1', 'u3', 'Cara');    // ROOM1 -> 2
    mgr.createRoom('h4', 'Dee', false);     // ROOM2 private
    const list = mgr.listPublicRooms();
    expect(list.map((r) => r.code)).toEqual(['ROOM1', 'ROOM0']);
    expect(list[0].memberCount).toBe(2);
  });
});
