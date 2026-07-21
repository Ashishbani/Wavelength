import { describe, it, expect, afterEach } from 'vitest';
import { openDb } from '../db/db.js';
import { createServer } from '../index.js';

async function cookieFor(base: string, email = 'a@b.com'): Promise<string> {
  const reg = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password1', displayName: 'Alice' }),
  });
  return reg.headers.get('set-cookie')!;
}

describe('playlist routes', () => {
  let server: Awaited<ReturnType<typeof createServer>>;
  afterEach(async () => { await server.close(); });
  async function start() {
    const db = openDb(':memory:');
    server = await createServer(0, db);
    return `http://localhost:${(server.httpServer.address() as { port: number }).port}`;
  }

  it('saves and lists a playlist for the owner', async () => {
    const base = await start();
    const cookie = await cookieFor(base);
    const create = await fetch(`${base}/api/playlists`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Chill', items: [{ videoId: 'dQw4w9WgXcQ', title: 'A' }] }),
    });
    expect(create.status).toBe(200);
    const list = await fetch(`${base}/api/playlists`, { headers: { cookie } });
    const { playlists } = await list.json();
    expect(playlists[0].name).toBe('Chill');
    expect(playlists[0].items).toHaveLength(1);
  });

  it('rejects an invalid videoId', async () => {
    const base = await start();
    const cookie = await cookieFor(base);
    const create = await fetch(`${base}/api/playlists`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Chill', items: [{ videoId: 'bad', title: 'A' }] }),
    });
    expect(create.status).toBe(400);
  });
});
