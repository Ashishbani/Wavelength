import { describe, it, expect, afterEach } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import { openDb } from './db/db.js';
import { createServer } from './index.js';
import { signToken } from './auth/token.js';
import { COOKIE_NAME } from './auth/routes.js';

describe('socket auth', () => {
  let server: Awaited<ReturnType<typeof createServer>>;
  const sockets: Socket[] = [];
  afterEach(async () => { sockets.forEach((s) => s.close()); sockets.length = 0; await server.close(); });

  async function start() {
    const db = openDb(':memory:');
    server = await createServer(0, db);
    return (server.httpServer.address() as { port: number }).port;
  }

  function connect(port: number, cookie?: string): Promise<Socket> {
    return new Promise((resolve) => {
      const s = ioc(`http://localhost:${port}`, {
        transports: ['websocket'],
        extraHeaders: cookie ? { cookie } : undefined,
      });
      s.on('connect', () => resolve(s));
    });
  }

  it('sets userId for an authed socket and null for a guest', async () => {
    const port = await start();
    const token = signToken({ userId: 'user-123' });

    const authed = await connect(port, `${COOKIE_NAME}=${token}`);
    sockets.push(authed);
    const a = await new Promise<{ userId: string | null }>((r) => authed.emit('whoami', r));
    expect(a.userId).toBe('user-123');

    const guest = await connect(port);
    sockets.push(guest);
    const g = await new Promise<{ userId: string | null }>((r) => guest.emit('whoami', r));
    expect(g.userId).toBeNull();
  });
});
