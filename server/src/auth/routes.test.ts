import { describe, it, expect, afterEach } from 'vitest';
import { openDb, migrate } from '../db/db.js';
import { createServer } from '../index.js';

describe('auth routes', () => {
  let server: ReturnType<typeof createServer>;
  afterEach(async () => { await server.close(); });

  function start() {
    const db = openDb(':memory:');
    migrate(db);
    server = createServer(0, db);
    const port = (server.httpServer.address() as { port: number }).port;
    return `http://localhost:${port}`;
  }

  it('registers, identifies via cookie, then logs out', async () => {
    const base = start();
    const reg = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', password: 'password1', displayName: 'Alice' }),
    });
    expect(reg.status).toBe(200);
    const cookie = reg.headers.get('set-cookie')!;
    expect(cookie).toContain('wl_token');
    const body = await reg.json();
    expect(body.displayName).toBe('Alice');

    const me = await fetch(`${base}/api/auth/me`, { headers: { cookie } });
    const meBody = await me.json();
    expect(meBody.user.email).toBe('a@b.com');

    const out = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { cookie } });
    expect(out.status).toBe(200);
  });

  it('rejects duplicate email', async () => {
    const base = start();
    const payload = { email: 'a@b.com', password: 'password1', displayName: 'Alice' };
    await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const dup = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    expect(dup.status).toBe(409);
  });

  it('rejects invalid body with 400', async () => {
    const base = start();
    const bad = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x', password: '1', displayName: '' }) });
    expect(bad.status).toBe(400);
  });

  it('logs in with correct password and rejects wrong one generically', async () => {
    const base = start();
    await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@b.com', password: 'password1', displayName: 'Alice' }) });
    const good = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@b.com', password: 'password1' }) });
    expect(good.status).toBe(200);
    const bad = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@b.com', password: 'nope' }) });
    expect(bad.status).toBe(401);
    expect((await bad.json()).error).toBe('Invalid email or password');
  });
});
