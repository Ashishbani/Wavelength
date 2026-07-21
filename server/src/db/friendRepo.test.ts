import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrate, type DB } from './db.js';
import { createUserRepo } from './userRepo.js';
import { createFriendRepo } from './friendRepo.js';

describe('friendRepo', () => {
  let db: DB;
  let friends: ReturnType<typeof createFriendRepo>;
  let alice: string;
  let bob: string;
  beforeEach(async () => {
    db = openDb(':memory:');
    await migrate(db);
    const users = createUserRepo(db);
    alice = (await users.create('a@b.com', 'h', 'Alice')).id;
    bob = (await users.create('b@b.com', 'h', 'Bob')).id;
    await users.setUsername(alice, 'alice');
    await users.setUsername(bob, 'bob');
    friends = createFriendRepo(db);
  });

  it('sends, lists, and accepts a request into a friendship', async () => {
    await friends.sendRequest(alice, bob);
    expect(await friends.listOutgoing(alice)).toHaveLength(1);
    const incoming = await friends.listIncoming(bob);
    expect(incoming[0].username).toBe('alice');
    expect(await friends.accept(incoming[0].id, bob)).toBe(true);
    expect(await friends.areFriends(alice, bob)).toBe(true);
    expect((await friends.listFriends(alice)).map((f) => f.userId)).toEqual([bob]);
    expect(await friends.friendIds(bob)).toEqual([alice]);
  });

  it('rejects self-request and duplicate/reverse edges', async () => {
    await expect(friends.sendRequest(alice, alice)).rejects.toThrow('SELF');
    await friends.sendRequest(alice, bob);
    await expect(friends.sendRequest(alice, bob)).rejects.toThrow('EDGE_EXISTS');
    await expect(friends.sendRequest(bob, alice)).rejects.toThrow('EDGE_EXISTS');
  });

  it('only the addressee can accept', async () => {
    await friends.sendRequest(alice, bob);
    const id = (await friends.listIncoming(bob))[0].id;
    expect(await friends.accept(id, alice)).toBe(false);
    expect(await friends.accept(id, bob)).toBe(true);
  });

  it('declines a request and allows unfriending', async () => {
    await friends.sendRequest(alice, bob);
    const id = (await friends.listIncoming(bob))[0].id;
    expect(await friends.decline(id, bob)).toBe(true);
    expect(await friends.areFriends(alice, bob)).toBe(false);

    await friends.sendRequest(alice, bob);
    const id2 = (await friends.listIncoming(bob))[0].id;
    await friends.accept(id2, bob);
    expect(await friends.unfriend(bob, alice)).toBe(true);
    expect(await friends.areFriends(alice, bob)).toBe(false);
  });
});
