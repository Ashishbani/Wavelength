import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrate, type DB } from './db.js';
import { createUserRepo } from './userRepo.js';
import { createRoomRepo } from './roomRepo.js';

describe('roomRepo', () => {
  let db: DB;
  let rooms: ReturnType<typeof createRoomRepo>;
  let ownerId: string;
  beforeEach(() => {
    db = openDb(':memory:');
    migrate(db);
    ownerId = createUserRepo(db).create('a@b.com', 'h', 'Alice').id;
    rooms = createRoomRepo(db);
  });

  it('creates, lists, and finds a saved room', () => {
    rooms.create(ownerId, 'ABC123', 'Friday Jams');
    expect(rooms.findByCode('ABC123')?.name).toBe('Friday Jams');
    expect(rooms.listByOwner(ownerId)).toHaveLength(1);
  });

  it('only deletes a room owned by the requester', () => {
    rooms.create(ownerId, 'ABC123', 'Friday Jams');
    expect(rooms.deleteByCode('ABC123', 'someone-else')).toBe(false);
    expect(rooms.deleteByCode('ABC123', ownerId)).toBe(true);
    expect(rooms.findByCode('ABC123')).toBeNull();
  });
});
