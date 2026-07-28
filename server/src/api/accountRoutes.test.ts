import { describe, it, expect, afterEach } from 'vitest';
import { openDb } from '../db/db.js';
import { createServer } from '../index.js';

describe('account routes — change password', () => {
  let server: Awaited<ReturnType<typeof createServer>>;
  afterEach(async () => { await server.close(); });
  async function start() {
    const db = openDb(':memory:');
    server = await createServer(0, db);
    return `http://localhost:${(server.httpServer.address() as { port: number }).port}`;
  }
  const json = { 'content-type': 'application/json' };

  // Chains several bcrypt operations — generous timeout for parallel CI load.
  it('rejects a wrong current password, accepts the right one, and old logins stop working', { timeout: 30000 }, async () => {
    const base = await start();
    const reg = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: json,
      body: JSON.stringify({ email: 'a@b.com', password: 'oldpassword1', displayName: 'Alice' }),
    });
    const cookie = reg.headers.get('set-cookie')!;

    const wrong = await fetch(`${base}/api/account/password`, {
      method: 'PUT', headers: { ...json, cookie },
      body: JSON.stringify({ currentPassword: 'WRONG', newPassword: 'newpassword1' }),
    });
    expect(wrong.status).toBe(401);

    const tooShort = await fetch(`${base}/api/account/password`, {
      method: 'PUT', headers: { ...json, cookie },
      body: JSON.stringify({ currentPassword: 'oldpassword1', newPassword: 'short' }),
    });
    expect(tooShort.status).toBe(400);

    const ok = await fetch(`${base}/api/account/password`, {
      method: 'PUT', headers: { ...json, cookie },
      body: JSON.stringify({ currentPassword: 'oldpassword1', newPassword: 'newpassword1' }),
    });
    expect(ok.status).toBe(200);

    const oldLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: json,
      body: JSON.stringify({ email: 'a@b.com', password: 'oldpassword1' }),
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: json,
      body: JSON.stringify({ email: 'a@b.com', password: 'newpassword1' }),
    });
    expect(newLogin.status).toBe(200);
  });

  it('requires a session', async () => {
    const base = await start();
    const res = await fetch(`${base}/api/account/password`, {
      method: 'PUT', headers: json,
      body: JSON.stringify({ currentPassword: 'x', newPassword: 'longenough1' }),
    });
    expect(res.status).toBe(401);
  });
});
