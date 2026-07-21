import { describe, it, expect, afterEach } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import { openDb } from '../db/db.js';
import { createServer } from '../index.js';
import { signToken } from '../auth/token.js';
import { COOKIE_NAME } from '../auth/routes.js';
import type { CreateJoinResult } from '@wavelength/shared';

describe('history logging + route', () => {
  let server: Awaited<ReturnType<typeof createServer>>;
  const sockets: Socket[] = [];
  afterEach(async () => { sockets.forEach((s) => s.close()); sockets.length = 0; await server.close(); });

  async function start() {
    const db = openDb(':memory:');
    server = await createServer(0, db);
    const port = (server.httpServer.address() as { port: number }).port;
    return { base: `http://localhost:${port}`, port, db };
  }
  function connect(port: number, cookie?: string): Promise<Socket> {
    return new Promise((resolve) => {
      const s = ioc(`http://localhost:${port}`, { transports: ['websocket'], extraHeaders: cookie ? { cookie } : undefined });
      s.on('connect', () => resolve(s));
    });
  }

  it('logs a played track for an authed host and exposes it via /api/history', async () => {
    const { base, port } = await start();
    const reg = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@b.com', password: 'password1', displayName: 'Alice' }) });
    const cookie = reg.headers.get('set-cookie')!.split(';')[0]; // wl_token=...
    const me = await (await fetch(`${base}/api/auth/me`, { headers: { cookie } })).json();
    const token = signToken({ userId: me.user.id });

    const host = await connect(port, `${COOKIE_NAME}=${token}`);
    sockets.push(host);
    const created = await new Promise<CreateJoinResult>((r) => host.emit('room:create', { name: 'Alice' }, r));
    if (!created.ok) throw new Error('create failed');

    host.emit('queue:add', { videoId: 'dQw4w9WgXcQ', title: 'Song' }); // auto-starts
    await new Promise((r) => setTimeout(r, 250));

    const hist = await (await fetch(`${base}/api/history`, { headers: { cookie } })).json();
    expect(hist.history.length).toBeGreaterThanOrEqual(1);
    expect(hist.history[0].videoId).toBe('dQw4w9WgXcQ');
    expect(hist.history[0].title).toBe('Song');
  });
});
