import { describe, it, expect, afterEach } from 'vitest';
import { openDb } from '../db/db.js';
import { createServer } from '../index.js';

const json = { 'content-type': 'application/json' };

describe('favourite routes', () => {
  let server: Awaited<ReturnType<typeof createServer>>;
  afterEach(async () => { await server.close(); });
  async function start() {
    const db = openDb(':memory:');
    server = await createServer(0, db);
    return `http://localhost:${(server.httpServer.address() as { port: number }).port}`;
  }
  async function registerAndCookie(base: string): Promise<string> {
    const reg = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: json,
      body: JSON.stringify({ email: 'a@b.com', password: 'password1', displayName: 'Alice' }),
    });
    return reg.headers.get('set-cookie')!;
  }

  it('requires auth', async () => {
    const base = await start();
    expect((await fetch(`${base}/api/favourites`)).status).toBe(401);
    const post = await fetch(`${base}/api/favourites`, {
      method: 'POST', headers: json, body: JSON.stringify({ videoId: 'dQw4w9WgXcQ', title: 'X' }),
    });
    expect(post.status).toBe(401);
  });

  it('adds, lists, de-duplicates and removes favourites', async () => {
    const base = await start();
    const cookie = await registerAndCookie(base);

    await fetch(`${base}/api/favourites`, {
      method: 'POST', headers: { ...json, cookie },
      body: JSON.stringify({ videoId: 'dQw4w9WgXcQ', title: 'Song A' }),
    });
    // favouriting the same track again must not duplicate it
    await fetch(`${base}/api/favourites`, {
      method: 'POST', headers: { ...json, cookie },
      body: JSON.stringify({ videoId: 'dQw4w9WgXcQ', title: 'Song A (renamed)' }),
    });
    await fetch(`${base}/api/favourites`, {
      method: 'POST', headers: { ...json, cookie },
      body: JSON.stringify({ videoId: 'track-id-1', title: 'My Upload', kind: 'lib' }),
    });

    const list = await fetch(`${base}/api/favourites`, { headers: { cookie } });
    const { favourites } = (await list.json()) as { favourites: { videoId: string; title: string; kind: string }[] };
    expect(favourites).toHaveLength(2);
    expect(favourites.find((f) => f.videoId === 'dQw4w9WgXcQ')?.title).toBe('Song A (renamed)');
    expect(favourites.find((f) => f.videoId === 'track-id-1')?.kind).toBe('lib');

    const del = await fetch(`${base}/api/favourites/dQw4w9WgXcQ`, { method: 'DELETE', headers: { cookie } });
    expect(del.status).toBe(200);
    const after = await (await fetch(`${base}/api/favourites`, { headers: { cookie } })).json() as { favourites: unknown[] };
    expect(after.favourites).toHaveLength(1);

    // removing something that isn't there
    const missing = await fetch(`${base}/api/favourites/nope`, { method: 'DELETE', headers: { cookie } });
    expect(missing.status).toBe(404);
  });

  it('rejects an invalid payload', async () => {
    const base = await start();
    const cookie = await registerAndCookie(base);
    const res = await fetch(`${base}/api/favourites`, {
      method: 'POST', headers: { ...json, cookie }, body: JSON.stringify({ videoId: '', title: '' }),
    });
    expect(res.status).toBe(400);
  });
});
