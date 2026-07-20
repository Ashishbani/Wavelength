import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrate, type DB } from './db.js';
import { createUserRepo } from './userRepo.js';
import { createPlaylistRepo } from './playlistRepo.js';

describe('playlistRepo', () => {
  let db: DB;
  let repo: ReturnType<typeof createPlaylistRepo>;
  let ownerId: string;
  beforeEach(() => {
    db = openDb(':memory:'); migrate(db);
    ownerId = createUserRepo(db).create('a@b.com', 'h', 'Alice').id;
    repo = createPlaylistRepo(db);
  });

  it('creates a playlist with ordered items', () => {
    const pl = repo.create(ownerId, 'Chill', [
      { videoId: 'dQw4w9WgXcQ', title: 'A' },
      { videoId: 'oHg5SJYRHA0', title: 'B' },
    ]);
    const found = repo.findById(pl.id);
    expect(found?.items.map((i) => i.title)).toEqual(['A', 'B']);
  });

  it('lists by owner and deletes with ownership check', () => {
    const pl = repo.create(ownerId, 'Chill', [{ videoId: 'dQw4w9WgXcQ', title: 'A' }]);
    expect(repo.listByOwner(ownerId)).toHaveLength(1);
    expect(repo.deleteById(pl.id, 'other')).toBe(false);
    expect(repo.deleteById(pl.id, ownerId)).toBe(true);
    expect(repo.findById(pl.id)).toBeNull();
  });
});
