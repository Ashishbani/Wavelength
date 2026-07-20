import { Router, type Request } from 'express';
import type { createPlaylistRepo } from '../db/playlistRepo.js';
import { createPlaylistSchema } from '../auth/validators.js';

function requireAuth(req: Request): string | null {
  return (req as Request & { userId?: string }).userId ?? null;
}

export function createPlaylistRouter(playlistRepo: ReturnType<typeof createPlaylistRepo>): Router {
  const router = Router();

  router.post('/', (req, res) => {
    const userId = requireAuth(req);
    if (!userId) return res.status(401).json({ error: 'Log in to save playlists.' });
    const parsed = createPlaylistSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid playlist.' });
    const pl = playlistRepo.create(userId, parsed.data.name, parsed.data.items);
    res.json({ id: pl.id, name: pl.name, items: pl.items });
  });

  router.get('/', (req, res) => {
    const userId = requireAuth(req);
    if (!userId) return res.status(401).json({ error: 'Log in to view playlists.' });
    res.json({ playlists: playlistRepo.listByOwner(userId).map((p) => ({ id: p.id, name: p.name, items: p.items })) });
  });

  router.delete('/:id', (req, res) => {
    const userId = requireAuth(req);
    if (!userId) return res.status(401).json({ error: 'Log in to delete playlists.' });
    const ok = playlistRepo.deleteById(req.params.id, userId);
    if (!ok) return res.status(404).json({ error: 'Playlist not found.' });
    res.json({ ok: true });
  });

  return router;
}
