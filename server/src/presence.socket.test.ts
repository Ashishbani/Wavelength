import { describe, it, expect, afterEach } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import { openDb, migrate, type DB } from './db/db.js';
import { createServer } from './index.js';
import { createUserRepo } from './db/userRepo.js';
import { createFriendRepo } from './db/friendRepo.js';
import { signToken } from './auth/token.js';
import { COOKIE_NAME } from './auth/routes.js';
import type { CreateJoinResult, PresenceInfo } from '@wavelength/shared';

describe('presence + invites over sockets', () => {
  let server: Awaited<ReturnType<typeof createServer>>;
  const sockets: Socket[] = [];
  afterEach(async () => { sockets.forEach((s) => s.close()); sockets.length = 0; await server.close(); });

  async function seedFriends(db: DB): Promise<{ alice: string; bob: string }> {
    const users = createUserRepo(db);
    const friends = createFriendRepo(db);
    const alice = (await users.create('a@b.com', 'h', 'Alice')).id;
    const bob = (await users.create('b@b.com', 'h', 'Bob')).id;
    await users.setUsername(alice, 'alice');
    await users.setUsername(bob, 'bob');
    await friends.sendRequest(alice, bob);
    const inc = (await friends.listIncoming(bob))[0];
    await friends.accept(inc.id, bob);
    return { alice, bob };
  }

  function connect(port: number, userId: string): Promise<Socket> {
    const token = signToken({ userId });
    return new Promise((resolve) => {
      const s = ioc(`http://localhost:${port}`, { transports: ['websocket'], extraHeaders: { cookie: `${COOKIE_NAME}=${token}` } });
      s.on('connect', () => resolve(s));
    });
  }

  it('notifies a friend when the other joins a room, and delivers invites', async () => {
    const db = openDb(':memory:'); await migrate(db);
    const { alice, bob } = await seedFriends(db);
    server = await createServer(0, db);
    const port = (server.httpServer.address() as { port: number }).port;

    const aSock = await connect(port, alice); sockets.push(aSock);
    const bSock = await connect(port, bob); sockets.push(bSock);

    // Alice hosts a room; Bob should receive a presence:update carrying the code.
    const presenceP = new Promise<PresenceInfo>((r) => bSock.on('presence:update', (info) => { if (info.userId === alice && info.roomCode) r(info); }));
    const created = await new Promise<CreateJoinResult>((r) => aSock.emit('room:create', { name: 'Alice' }, r));
    if (!created.ok) throw new Error('create failed');
    const info = await presenceP;
    expect(info.roomCode).toBe(created.state.code);

    // Alice invites Bob; Bob receives invite:receive with the code.
    const inviteP = new Promise<{ code: string; fromDisplayName: string }>((r) => bSock.on('invite:receive', r));
    aSock.emit('invite:send', { toUserId: bob });
    const invite = await inviteP;
    expect(invite.code).toBe(created.state.code);
    expect(invite.fromDisplayName).toBe('Alice');
  });
});
