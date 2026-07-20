import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrate, type DB } from './db.js';
import { createUserRepo } from './userRepo.js';
import { createHistoryRepo } from './historyRepo.js';

describe('historyRepo', () => {
  let db: DB;
  let repo: ReturnType<typeof createHistoryRepo>;
  let uid: string;
  beforeEach(() => {
    db = openDb(':memory:'); migrate(db);
    uid = createUserRepo(db).create('a@b.com', 'h', 'Alice').id;
    repo = createHistoryRepo(db);
  });

  it('records and returns history most-recent-first', () => {
    repo.add(uid, 'dQw4w9WgXcQ', 'First');
    repo.add(uid, 'oHg5SJYRHA0', 'Second');
    const list = repo.listByUser(uid);
    expect(list).toHaveLength(2);
    expect(list[0].title).toBe('Second');
  });

  it('scopes history to the user', () => {
    const other = createUserRepo(db).create('b@b.com', 'h', 'Bob').id;
    repo.add(uid, 'dQw4w9WgXcQ', 'Mine');
    expect(repo.listByUser(other)).toHaveLength(0);
  });
});
