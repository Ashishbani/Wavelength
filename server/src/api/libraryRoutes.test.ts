import { describe, it, expect, afterEach } from 'vitest';
import { openDb } from '../db/db.js';
import { createServer } from '../index.js';

async function registerAndCookie(base: string): Promise<string> {
  const reg = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.com', password: 'password1', displayName: 'Alice' }),
  });
  return reg.headers.get('set-cookie')!;
}

describe('library routes', () => {
  let server: Awaited<ReturnType<typeof createServer>>;
  afterEach(async () => { await server.close(); });
  async function start() {
    const db = openDb(':memory:');
    server = await createServer(0, db);
    return `http://localhost:${(server.httpServer.address() as { port: number }).port}`;
  }

  it('requires auth to upload', async () => {
    const base = await start();
    const res = await fetch(`${base}/api/library?title=X`, {
      method: 'POST', headers: { 'content-type': 'audio/mpeg' }, body: Buffer.from('xx'),
    });
    expect(res.status).toBe(401);
  });

  it('uploads, lists, streams (with ranges), and deletes a track', async () => {
    const base = await start();
    const cookie = await registerAndCookie(base);
    const bytes = Buffer.from('0123456789abcdef');

    const up = await fetch(`${base}/api/library?title=My%20Song`, {
      method: 'POST', headers: { 'content-type': 'audio/mpeg', cookie }, body: bytes,
    });
    expect(up.status).toBe(200);
    const { id } = (await up.json()) as { id: string };

    const list = await fetch(`${base}/api/library`, { headers: { cookie } });
    const { tracks } = (await list.json()) as { tracks: unknown };
    expect(tracks).toEqual([{ id, title: 'My Song', size: bytes.length }]);

    const full = await fetch(`${base}/api/library/${id}/audio`);
    expect(full.status).toBe(200);
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    expect(Buffer.from(await full.arrayBuffer()).equals(bytes)).toBe(true);

    const part = await fetch(`${base}/api/library/${id}/audio`, { headers: { range: 'bytes=4-7' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 4-7/${bytes.length}`);
    expect(Buffer.from(await part.arrayBuffer()).toString()).toBe('4567');

    const del = await fetch(`${base}/api/library/${id}`, { method: 'DELETE', headers: { cookie } });
    expect(del.status).toBe(200);
    const gone = await fetch(`${base}/api/library/${id}/audio`);
    expect(gone.status).toBe(404);
  });

  it('rejects non-audio uploads', async () => {
    const base = await start();
    const cookie = await registerAndCookie(base);
    const res = await fetch(`${base}/api/library?title=X`, {
      method: 'POST', headers: { 'content-type': 'text/plain', cookie }, body: 'hello',
    });
    expect([400, 415]).toContain(res.status);
  });
});
