import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrate, type DB } from './db.js';
import { createUserRepo } from './userRepo.js';
import { createRoomRepo } from './roomRepo.js';

describe('roomRepo', () => {
  let db: DB;
  let rooms: ReturnType<typeof createRoomRepo>;
  let ownerId: string;
  beforeEach(async () => {
    db = openDb(':memory:');
    await migrate(db);
    ownerId = (await createUserRepo(db).create('a@b.com', 'h', 'Alice')).id;
    rooms = createRoomRepo(db);
  });

  it('creates, lists, and finds a saved room', async () => {
    await rooms.create(ownerId, 'ABC123', 'Friday Jams');
    expect((await rooms.findByCode('ABC123'))?.name).toBe('Friday Jams');
    expect(await rooms.listByOwner(ownerId)).toHaveLength(1);
  });

  it('only deletes a room owned by the requester', async () => {
    await rooms.create(ownerId, 'ABC123', 'Friday Jams');
    expect(await rooms.deleteByCode('ABC123', 'someone-else')).toBe(false);
    expect(await rooms.deleteByCode('ABC123', ownerId)).toBe(true);
    expect(await rooms.findByCode('ABC123')).toBeNull();
  });
});
