import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrate, type DB } from './db.js';
import { createUserRepo } from './userRepo.js';

describe('userRepo', () => {
  let db: DB;
  let repo: ReturnType<typeof createUserRepo>;
  beforeEach(async () => {
    db = openDb(':memory:');
    await migrate(db);
    repo = createUserRepo(db);
  });

  it('creates and finds a user by email', async () => {
    const u = await repo.create('a@b.com', 'hash1', 'Alice');
    expect(u.id).toBeTruthy();
    expect(u.email).toBe('a@b.com');
    const found = await repo.findByEmail('a@b.com');
    expect(found?.passwordHash).toBe('hash1');
    expect(found?.displayName).toBe('Alice');
  });

  it('finds a user by id without exposing the hash', async () => {
    const u = await repo.create('a@b.com', 'hash1', 'Alice');
    const byId = await repo.findById(u.id);
    expect(byId?.email).toBe('a@b.com');
    expect((byId as unknown as Record<string, unknown>).passwordHash).toBeUndefined();
  });

  it('returns null for unknown lookups', async () => {
    expect(await repo.findByEmail('nope@x.com')).toBeNull();
    expect(await repo.findById('nope')).toBeNull();
  });

  it('rejects a duplicate email', async () => {
    await repo.create('a@b.com', 'h', 'Alice');
    await expect(repo.create('a@b.com', 'h2', 'Bob')).rejects.toThrow('EMAIL_TAKEN');
  });

  it('sets and finds a user by username (case-insensitive)', async () => {
    const u = await repo.create('a@b.com', 'h', 'Alice');
    await repo.setUsername(u.id, 'AliceCat');
    expect((await repo.findByUsername('alicecat'))?.id).toBe(u.id);
    expect((await repo.findById(u.id))?.username).toBe('alicecat');
  });

  it('rejects a duplicate username', async () => {
    const a = await repo.create('a@b.com', 'h', 'Alice');
    const b = await repo.create('b@b.com', 'h', 'Bob');
    await repo.setUsername(a.id, 'dj');
    await expect(repo.setUsername(b.id, 'DJ')).rejects.toThrow('USERNAME_TAKEN');
  });
});
