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

  it('rejects a duplicate name in the same room', () => {
    mgr.createRoom('h1', 'Alice');
    expect(() => mgr.joinRoom('ROOM0', 'u2', 'Alice')).toThrow('NAME_TAKEN');
  });

  it('promotes the next member to host when the host leaves', () => {
    mgr.createRoom('h1', 'Alice');
    mgr.joinRoom('ROOM0', 'u2', 'Bob');
    const res = mgr.leaveRoom('h1');
    expect(res?.state?.hostId).toBe('u2');
    expect(res?.state?.members).toHaveLength(1);
  });

  it('deletes the room when the last member leaves', () => {
    mgr.createRoom('h1', 'Alice');
    const res = mgr.leaveRoom('h1');
    expect(res?.state).toBeNull();
    expect(mgr.getRoom('ROOM0')).toBeNull();
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
});
