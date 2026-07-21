import { describe, it, expect, afterEach } from 'vitest';
import { openDb } from '../db/db.js';
import { createServer } from '../index.js';

async function makeUser(base: string, email: string, displayName: string, username: string): Promise<string> {
  const reg = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password1', displayName }),
  });
  const cookie = reg.headers.get('set-cookie')!.split(';')[0];
  await fetch(`${base}/api/account/username`, {
    method: 'PUT', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ username }),
  });
  return cookie;
}

describe('friend routes', () => {
  let server: Awaited<ReturnType<typeof createServer>>;
  afterEach(async () => { await server.close(); });
  async function start() {
    const db = openDb(':memory:');
    server = await createServer(0, db);
    return `http://localhost:${(server.httpServer.address() as { port: number }).port}`;
  }

  it('runs the full request → accept → friends lifecycle', async () => {
    const base = await start();
    const aCookie = await makeUser(base, 'a@b.com', 'Alice', 'alice');
    const bCookie = await makeUser(base, 'b@b.com', 'Bob', 'bob');

    const send = await fetch(`${base}/api/friends/requests`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: aCookie }, body: JSON.stringify({ username: 'bob' }) });
    expect(send.status).toBe(200);

    const reqs = await (await fetch(`${base}/api/friends/requests`, { headers: { cookie: bCookie } })).json();
    expect(reqs.incoming).toHaveLength(1);
    const reqId = reqs.incoming[0].id;

    const accept = await fetch(`${base}/api/friends/requests/${reqId}/accept`, { method: 'POST', headers: { cookie: bCookie } });
    expect(accept.status).toBe(200);

    const aFriends = await (await fetch(`${base}/api/friends`, { headers: { cookie: aCookie } })).json();
    expect(aFriends.friends[0].username).toBe('bob');
  });

  it('gates social features until a handle is set', async () => {
    const base = await start();
    const reg = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'c@b.com', password: 'password1', displayName: 'Cara' }) });
    const cookie = reg.headers.get('set-cookie')!.split(';')[0];
    const res = await fetch(`${base}/api/friends`, { headers: { cookie } });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('NEEDS_HANDLE');
  });

  it('rejects a duplicate friend request', async () => {
    const base = await start();
    const aCookie = await makeUser(base, 'a@b.com', 'Alice', 'alice');
    await makeUser(base, 'b@b.com', 'Bob', 'bob');
    await fetch(`${base}/api/friends/requests`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: aCookie }, body: JSON.stringify({ username: 'bob' }) });
    const dup = await fetch(`${base}/api/friends/requests`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: aCookie }, body: JSON.stringify({ username: 'bob' }) });
    expect(dup.status).toBe(409);
  });
});
