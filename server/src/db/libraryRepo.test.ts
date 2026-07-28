import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrate, type DB } from './db.js';
import { createLibraryRepo, CHUNK_SIZE } from './libraryRepo.js';
import { createUserRepo } from './userRepo.js';

describe('libraryRepo', () => {
  let db: DB;
  let repo: ReturnType<typeof createLibraryRepo>;
  let u1: string;
  beforeEach(async () => {
    db = openDb(':memory:');
    await migrate(db);
    repo = createLibraryRepo(db);
    u1 = (await createUserRepo(db).create('a@b.com', 'h', 'Alice')).id;
  });

  it('stores a track across chunks and reads it back intact', async () => {
    const bytes = Buffer.alloc(CHUNK_SIZE + 1234); // spans 2 chunks
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    const t = await repo.create(u1, 'Song', 'audio/mpeg', bytes);
    expect(t.size).toBe(bytes.length);
    const back = await repo.readRange(t.id, 0, bytes.length - 1);
    expect(back.equals(bytes)).toBe(true);
  });

  it('reads a byte range spanning a chunk boundary', async () => {
    const bytes = Buffer.alloc(CHUNK_SIZE * 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) % 256;
    const t = await repo.create(u1, 'Song', 'audio/mpeg', bytes);
    const start = CHUNK_SIZE - 10;
    const end = CHUNK_SIZE + 9;
    const back = await repo.readRange(t.id, start, end);
    expect(back.length).toBe(20);
    expect(back.equals(bytes.subarray(start, end + 1))).toBe(true);
  });

  it('lists by owner and deletes only for the owner', async () => {
    const t = await repo.create(u1, 'Song', 'audio/mpeg', Buffer.from('abc'));
    expect((await repo.listByOwner(u1)).map((x) => x.id)).toEqual([t.id]);
    expect(await repo.deleteById(t.id, 'someone-else')).toBe(false);
    expect(await repo.deleteById(t.id, u1)).toBe(true);
    expect(await repo.findById(t.id)).toBeNull();
  });
});
