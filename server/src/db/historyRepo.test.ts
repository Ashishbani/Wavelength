import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrate, type DB } from './db.js';
import { createUserRepo } from './userRepo.js';
import { createHistoryRepo } from './historyRepo.js';

describe('historyRepo', () => {
  let db: DB;
  let repo: ReturnType<typeof createHistoryRepo>;
  let uid: string;
  beforeEach(async () => {
    db = openDb(':memory:'); await migrate(db);
    uid = (await createUserRepo(db).create('a@b.com', 'h', 'Alice')).id;
    repo = createHistoryRepo(db);
  });

  it('records and returns history most-recent-first', async () => {
    await repo.add(uid, 'dQw4w9WgXcQ', 'First');
    await repo.add(uid, 'oHg5SJYRHA0', 'Second');
    const list = await repo.listByUser(uid);
    expect(list).toHaveLength(2);
    expect(list[0].title).toBe('Second');
  });

  it('returns every play so the client can group by day', async () => {
    await repo.add(uid, 'dQw4w9WgXcQ', 'Repeat');
    await repo.add(uid, 'oHg5SJYRHA0', 'Other');
    await repo.add(uid, 'dQw4w9WgXcQ', 'Repeat'); // played again
    await repo.add(uid, 'dQw4w9WgXcQ', 'Repeat'); // and again
    const list = await repo.listByUser(uid);
    expect(list).toHaveLength(4);                   // nothing collapsed server-side
    expect(list[0].title).toBe('Repeat');           // newest first
    expect(list.every((h) => typeof h.playedAt === 'number')).toBe(true);
  });

  it('caps how many plays it returns', async () => {
    for (let i = 0; i < 5; i++) await repo.add(uid, 'dQw4w9WgXcQ', 'Song');
    expect(await repo.listByUser(uid, 3)).toHaveLength(3);
  });

  it('scopes history to the user', async () => {
    const other = (await createUserRepo(db).create('b@b.com', 'h', 'Bob')).id;
    await repo.add(uid, 'dQw4w9WgXcQ', 'Mine');
    expect(await repo.listByUser(other)).toHaveLength(0);
  });
});
