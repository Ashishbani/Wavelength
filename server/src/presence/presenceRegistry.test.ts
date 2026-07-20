import { describe, it, expect, beforeEach } from 'vitest';
import { PresenceRegistry } from './presenceRegistry.js';

describe('PresenceRegistry', () => {
  let p: PresenceRegistry;
  beforeEach(() => { p = new PresenceRegistry(); });

  it('marks a user online while any socket is connected', () => {
    p.addSocket('u1', 's1');
    p.addSocket('u1', 's2');
    expect(p.isOnline('u1')).toBe(true);
    expect(p.removeSocket('u1', 's1').nowOffline).toBe(false);
    expect(p.isOnline('u1')).toBe(true);
    expect(p.removeSocket('u1', 's2').nowOffline).toBe(true);
    expect(p.isOnline('u1')).toBe(false);
  });

  it('tracks and clears the current room', () => {
    p.addSocket('u1', 's1');
    p.setRoom('u1', 'ABC123');
    expect(p.getPresence('u1')).toEqual({ online: true, roomCode: 'ABC123' });
    p.setRoom('u1', null);
    expect(p.getPresence('u1')).toEqual({ online: true, roomCode: null });
  });

  it('reports offline presence for unknown users', () => {
    expect(p.getPresence('nobody')).toEqual({ online: false, roomCode: null });
  });

  it('drops room when the user goes offline', () => {
    p.addSocket('u1', 's1');
    p.setRoom('u1', 'ABC123');
    p.removeSocket('u1', 's1');
    expect(p.getPresence('u1')).toEqual({ online: false, roomCode: null });
  });
});
