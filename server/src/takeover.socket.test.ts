import { describe, it, expect, afterEach } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import { openDb } from './db/db.js';
import { createServer } from './index.js';
import { signToken } from './auth/token.js';
import { COOKIE_NAME } from './auth/routes.js';
import type { CreateJoinResult } from '@wavelength/shared';

describe('one seat per account (session take-over)', () => {
  let server: Awaited<ReturnType<typeof createServer>>;
  const sockets: Socket[] = [];
  afterEach(async () => { sockets.forEach((s) => s.close()); sockets.length = 0; await server.close(); });

  async function start() {
    const db = openDb(':memory:');
    server = await createServer(0, db);
    return (server.httpServer.address() as { port: number }).port;
  }
  function connect(port: number, userId: string): Promise<Socket> {
    const token = signToken({ userId });
    return new Promise((res) => {
      const s = ioc(`http://localhost:${port}`, { transports: ['websocket'], extraHeaders: { cookie: `${COOKIE_NAME}=${token}` } });
      s.on('connect', () => res(s));
    });
  }

  it('a second tab of the same account takes over the seat (no duplicate)', async () => {
    const port = await start();
    const a = await connect(port, 'user-1'); sockets.push(a);
    const created = await new Promise<CreateJoinResult>((r) => a.emit('room:create', { name: 'Bani' }, r));
    if (!created.ok) throw new Error('create failed');
    const code = created.state.code;

    const b = await connect(port, 'user-1'); sockets.push(b);
    const superseded = new Promise<boolean>((r) => a.on('session:superseded', () => r(true)));
    const joined = await new Promise<CreateJoinResult>((r) => b.emit('room:join', { code, name: 'Bani' }, r));

    expect(joined.ok).toBe(true);
    expect(await superseded).toBe(true);
    if (!joined.ok) return;
    expect(joined.state.members.map((m) => m.name)).toEqual(['Bani']); // one seat, no '(2)'
    expect(joined.state.hostId).toBe(joined.selfId); // new tab reclaims host
  });

  it('different accounts remain separate members', async () => {
    const port = await start();
    const a = await connect(port, 'user-1'); sockets.push(a);
    const created = await new Promise<CreateJoinResult>((r) => a.emit('room:create', { name: 'Alice' }, r));
    if (!created.ok) throw new Error('create failed');
    const b = await connect(port, 'user-2'); sockets.push(b);
    const joined = await new Promise<CreateJoinResult>((r) => b.emit('room:join', { code: created.state.code, name: 'Bob' }, r));
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(joined.state.members).toHaveLength(2);
  });
});
