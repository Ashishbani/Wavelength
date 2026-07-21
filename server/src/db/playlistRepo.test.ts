import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrate, type DB } from './db.js';
import { createUserRepo } from './userRepo.js';
import { createPlaylistRepo } from './playlistRepo.js';

describe('playlistRepo', () => {
  let db: DB;
  let repo: ReturnType<typeof createPlaylistRepo>;
  let ownerId: string;
  beforeEach(async () => {
    db = openDb(':memory:'); await migrate(db);
    ownerId = (await createUserRepo(db).create('a@b.com', 'h', 'Alice')).id;
    repo = createPlaylistRepo(db);
  });

  it('creates a playlist with ordered items', async () => {
    const pl = await repo.create(ownerId, 'Chill', [
      { videoId: 'dQw4w9WgXcQ', title: 'A' },
      { videoId: 'oHg5SJYRHA0', title: 'B' },
    ]);
    const found = await repo.findById(pl.id);
    expect(found?.items.map((i) => i.title)).toEqual(['A', 'B']);
  });

  it('lists by owner and deletes with ownership check', async () => {
    const pl = await repo.create(ownerId, 'Chill', [{ videoId: 'dQw4w9WgXcQ', title: 'A' }]);
    expect(await repo.listByOwner(ownerId)).toHaveLength(1);
    expect(await repo.deleteById(pl.id, 'other')).toBe(false);
    expect(await repo.deleteById(pl.id, ownerId)).toBe(true);
    expect(await repo.findById(pl.id)).toBeNull();
  });
});
