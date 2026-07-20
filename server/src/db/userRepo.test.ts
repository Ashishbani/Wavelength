import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrate, type DB } from './db.js';
import { createUserRepo } from './userRepo.js';

describe('userRepo', () => {
  let db: DB;
  let repo: ReturnType<typeof createUserRepo>;
  beforeEach(() => {
    db = openDb(':memory:');
    migrate(db);
    repo = createUserRepo(db);
  });

  it('creates and finds a user by email', () => {
    const u = repo.create('a@b.com', 'hash1', 'Alice');
    expect(u.id).toBeTruthy();
    expect(u.email).toBe('a@b.com');
    const found = repo.findByEmail('a@b.com');
    expect(found?.passwordHash).toBe('hash1');
    expect(found?.displayName).toBe('Alice');
  });

  it('finds a user by id without exposing the hash', () => {
    const u = repo.create('a@b.com', 'hash1', 'Alice');
    const byId = repo.findById(u.id);
    expect(byId?.email).toBe('a@b.com');
    expect((byId as unknown as Record<string, unknown>).passwordHash).toBeUndefined();
  });

  it('returns null for unknown lookups', () => {
    expect(repo.findByEmail('nope@x.com')).toBeNull();
    expect(repo.findById('nope')).toBeNull();
  });

  it('rejects a duplicate email', () => {
    repo.create('a@b.com', 'h', 'Alice');
    expect(() => repo.create('a@b.com', 'h2', 'Bob')).toThrow('EMAIL_TAKEN');
  });

  it('sets and finds a user by username (case-insensitive)', () => {
    const u = repo.create('a@b.com', 'h', 'Alice');
    repo.setUsername(u.id, 'AliceCat');
    expect(repo.findByUsername('alicecat')?.id).toBe(u.id);
    expect(repo.findById(u.id)?.username).toBe('alicecat');
  });

  it('rejects a duplicate username', () => {
    const a = repo.create('a@b.com', 'h', 'Alice');
    const b = repo.create('b@b.com', 'h', 'Bob');
    repo.setUsername(a.id, 'dj');
    expect(() => repo.setUsername(b.id, 'DJ')).toThrow('USERNAME_TAKEN');
  });
});
