import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrate, type DB } from './db.js';
import { createUserRepo } from './userRepo.js';
import { createFriendRepo } from './friendRepo.js';

describe('friendRepo', () => {
  let db: DB;
  let friends: ReturnType<typeof createFriendRepo>;
  let alice: string;
  let bob: string;
  beforeEach(() => {
    db = openDb(':memory:');
    migrate(db);
    const users = createUserRepo(db);
    alice = users.create('a@b.com', 'h', 'Alice').id;
    bob = users.create('b@b.com', 'h', 'Bob').id;
    users.setUsername(alice, 'alice');
    users.setUsername(bob, 'bob');
    friends = createFriendRepo(db);
  });

  it('sends, lists, and accepts a request into a friendship', () => {
    friends.sendRequest(alice, bob);
    expect(friends.listOutgoing(alice)).toHaveLength(1);
    const incoming = friends.listIncoming(bob);
    expect(incoming[0].username).toBe('alice');
    expect(friends.accept(incoming[0].id, bob)).toBe(true);
    expect(friends.areFriends(alice, bob)).toBe(true);
    expect(friends.listFriends(alice).map((f) => f.userId)).toEqual([bob]);
    expect(friends.friendIds(bob)).toEqual([alice]);
  });

  it('rejects self-request and duplicate/reverse edges', () => {
    expect(() => friends.sendRequest(alice, alice)).toThrow('SELF');
    friends.sendRequest(alice, bob);
    expect(() => friends.sendRequest(alice, bob)).toThrow('EDGE_EXISTS');
    expect(() => friends.sendRequest(bob, alice)).toThrow('EDGE_EXISTS');
  });

  it('only the addressee can accept', () => {
    friends.sendRequest(alice, bob);
    const id = friends.listIncoming(bob)[0].id;
    expect(friends.accept(id, alice)).toBe(false);
    expect(friends.accept(id, bob)).toBe(true);
  });

  it('declines a request and allows unfriending', () => {
    friends.sendRequest(alice, bob);
    const id = friends.listIncoming(bob)[0].id;
    expect(friends.decline(id, bob)).toBe(true);
    expect(friends.areFriends(alice, bob)).toBe(false);

    friends.sendRequest(alice, bob);
    const id2 = friends.listIncoming(bob)[0].id;
    friends.accept(id2, bob);
    expect(friends.unfriend(bob, alice)).toBe(true);
    expect(friends.areFriends(alice, bob)).toBe(false);
  });
});
