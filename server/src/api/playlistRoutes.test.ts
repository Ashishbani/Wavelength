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

  it('saves an uploaded track and preserves its kind', async () => {
    const base = await start();
    const cookie = await cookieFor(base);
    // Uploaded tracks are uuids, not 11-char YouTube ids — saving a queue that
    // contained one used to be rejected outright as "Invalid playlist".
    const uuid = '4d1f2c9a-0b7e-4a1d-9f3c-7e2b8a5c1d60';
    const create = await fetch(`${base}/api/playlists`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Mixed', items: [
          { videoId: uuid, title: 'My upload', kind: 'lib' },
          { videoId: 'dQw4w9WgXcQ', title: 'A YouTube one', kind: 'yt' },
        ],
      }),
    });
    expect(create.status).toBe(200);
    const list = await fetch(`${base}/api/playlists`, { headers: { cookie } });
    const { playlists } = (await list.json()) as { playlists: { items: { videoId: string; kind?: string }[] }[] };
    const items = playlists[0].items;
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.videoId === uuid)?.kind).toBe('lib');
    expect(items.find((i) => i.videoId === 'dQw4w9WgXcQ')?.kind).toBe('yt');
  });

  it('rejects a malformed videoId', async () => {
    const base = await start();
    const cookie = await cookieFor(base);
    for (const videoId of ['has spaces', 'x'.repeat(65), '']) {
      const create = await fetch(`${base}/api/playlists`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ name: 'Chill', items: [{ videoId, title: 'A' }] }),
      });
      expect(create.status).toBe(400);
    }
  });
});
