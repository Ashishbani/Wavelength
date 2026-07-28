import express, { Router, type Request, type Response } from 'express';
import type { createLibraryRepo } from '../db/libraryRepo.js';

const MAX_TRACK_BYTES = 12 * 1024 * 1024; // ~12 MB ≈ a 10–12 min MP3
const MAX_TRACKS_PER_USER = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function authed(req: Request): string | null {
  return (req as Request & { userId?: string }).userId ?? null;
}

/** Parse a "bytes=start-end" / "bytes=start-" / "bytes=-suffix" Range header. */
function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return null;
  let start: number, end: number;
  if (m[1] === '') { // suffix: last N bytes
    const n = Number(m[2]);
    if (n === 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return null;
  return { start, end };
}

export function createLibraryRouter(libraryRepo: ReturnType<typeof createLibraryRepo>): Router {
  const router = Router();

  // Upload: raw audio bytes in the body, title as a query param.
  router.post(
    '/',
    express.raw({ type: ['audio/*', 'application/octet-stream'], limit: MAX_TRACK_BYTES }),
    async (req, res) => {
      const userId = authed(req);
      if (!userId) return res.status(401).json({ error: 'Log in to upload music.' });
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        return res.status(400).json({ error: 'Send the audio file bytes as the request body.' });
      }
      const title = String(req.query.title ?? '').trim().slice(0, 120);
      if (!title) return res.status(400).json({ error: 'A title is required.' });
      const mime = (req.headers['content-type'] ?? 'audio/mpeg').split(';')[0].trim();
      if (!mime.startsWith('audio/') && mime !== 'application/octet-stream') {
        return res.status(415).json({ error: 'Only audio files are supported.' });
      }
      const existing = await libraryRepo.listByOwner(userId);
      if (existing.length >= MAX_TRACKS_PER_USER) {
        return res.status(409).json({ error: `Library is full (max ${MAX_TRACKS_PER_USER} tracks). Delete some first.` });
      }
      const track = await libraryRepo.create(userId, title, mime, body);
      res.json({ id: track.id, title: track.title, size: track.size });
    },
  );

  router.get('/', async (req, res) => {
    const userId = authed(req);
    if (!userId) return res.status(401).json({ error: 'Log in to view your music.' });
    const tracks = await libraryRepo.listByOwner(userId);
    res.json({ tracks: tracks.map((t) => ({ id: t.id, title: t.title, size: t.size })) });
  });

  // Audio bytes, with Range support (Safari requires it for media seeking).
  // Reachable by anyone with the track's unguessable id, so every room member
  // (including guests) can stream a queued track.
  router.get('/:id/audio', async (req: Request, res: Response) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(404).end();
    const track = await libraryRepo.findById(id);
    if (!track) return res.status(404).end();

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', track.mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');

    const range = parseRange(req.headers.range, track.size);
    if (range) {
      const bytes = await libraryRepo.readRange(id, range.start, range.end);
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${track.size}`);
      res.setHeader('Content-Length', bytes.length);
      return res.end(bytes);
    }
    const bytes = await libraryRepo.readRange(id, 0, track.size - 1);
    res.setHeader('Content-Length', bytes.length);
    res.end(bytes);
  });

  router.delete('/:id', async (req, res) => {
    const userId = authed(req);
    if (!userId) return res.status(401).json({ error: 'Log in first.' });
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Track not found.' });
    const ok = await libraryRepo.deleteById(req.params.id, userId);
    if (!ok) return res.status(404).json({ error: 'Track not found.' });
    res.json({ ok: true });
  });

  return router;
}
