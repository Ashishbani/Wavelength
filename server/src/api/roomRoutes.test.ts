import { describe, it, expect, afterEach } from 'vitest';
import { openDb, migrate } from '../db/db.js';
import { createServer } from '../index.js';

async function registerAndCookie(base: string): Promise<string> {
  const reg = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.com', password: 'password1', displayName: 'Alice' }),
  });
  return reg.headers.get('set-cookie')!;
}

describe('room routes', () => {
  let server: ReturnType<typeof createServer>;
  afterEach(async () => { await server.close(); });
  function start() {
    const db = openDb(':memory:'); migrate(db);
    server = createServer(0, db);
    return `http://localhost:${(server.httpServer.address() as { port: number }).port}`;
  }

  it('requires auth to create a saved room', async () => {
    const base = start();
    const res = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'X' }) });
    expect(res.status).toBe(401);
  });

  it('creates and lists a saved room for the owner', async () => {
    const base = start();
    const cookie = await registerAndCookie(base);
    const create = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'Friday Jams' }) });
    expect(create.status).toBe(200);
    const { code } = await create.json();
    expect(code).toHaveLength(6);
    const list = await fetch(`${base}/api/rooms`, { headers: { cookie } });
    const { rooms } = await list.json();
    expect(rooms).toEqual([{ code, name: 'Friday Jams' }]);
  });
});
