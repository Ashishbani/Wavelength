import { describe, it, expect, afterEach } from 'vitest';
import { openDb } from '../db/db.js';
import { createServer } from '../index.js';

const json = { 'content-type': 'application/json' };

describe('forgot / reset password', () => {
  let server: Awaited<ReturnType<typeof createServer>>;
  afterEach(async () => { await server.close(); });

  async function start(sendMail: ((to: string, subject: string, text: string) => Promise<void>) | null) {
    const db = openDb(':memory:');
    server = await createServer(0, db, { sendMail });
    return `http://localhost:${(server.httpServer.address() as { port: number }).port}`;
  }

  it('runs the full email-code reset flow', { timeout: 30000 }, async () => {
    const sent: { to: string; text: string }[] = [];
    const base = await start(async (to, _s, text) => { sent.push({ to, text }); });

    await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: json,
      body: JSON.stringify({ email: 'a@b.com', password: 'oldpassword1', displayName: 'Alice' }),
    });

    // Unknown email → same generic response, no mail sent
    const unknown = await fetch(`${base}/api/auth/forgot`, {
      method: 'POST', headers: json, body: JSON.stringify({ email: 'nobody@x.com' }),
    });
    expect(unknown.status).toBe(200);
    expect(sent).toHaveLength(0);

    // Known email → code emailed
    const forgot = await fetch(`${base}/api/auth/forgot`, {
      method: 'POST', headers: json, body: JSON.stringify({ email: 'a@b.com' }),
    });
    expect(forgot.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('a@b.com');
    const code = sent[0].text.match(/code is: (\d{6})/)![1];

    // Wrong code rejected
    const bad = await fetch(`${base}/api/auth/reset`, {
      method: 'POST', headers: json,
      body: JSON.stringify({ email: 'a@b.com', code: code === '000000' ? '000001' : '000000', newPassword: 'newpassword1' }),
    });
    expect(bad.status).toBe(400);

    // Right code resets the password
    const ok = await fetch(`${base}/api/auth/reset`, {
      method: 'POST', headers: json,
      body: JSON.stringify({ email: 'a@b.com', code, newPassword: 'newpassword1' }),
    });
    expect(ok.status).toBe(200);

    // Code is single-use
    const reuse = await fetch(`${base}/api/auth/reset`, {
      method: 'POST', headers: json,
      body: JSON.stringify({ email: 'a@b.com', code, newPassword: 'anotherpass1' }),
    });
    expect(reuse.status).toBe(400);

    // Old password dead, new one works
    const oldLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: json, body: JSON.stringify({ email: 'a@b.com', password: 'oldpassword1' }),
    });
    expect(oldLogin.status).toBe(401);
    const newLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: json, body: JSON.stringify({ email: 'a@b.com', password: 'newpassword1' }),
    });
    expect(newLogin.status).toBe(200);
  });

  it('reports honestly when email is not configured', async () => {
    const base = await start(null);
    const res = await fetch(`${base}/api/auth/forgot`, {
      method: 'POST', headers: json, body: JSON.stringify({ email: 'a@b.com' }),
    });
    expect(res.status).toBe(503);
  });
});
