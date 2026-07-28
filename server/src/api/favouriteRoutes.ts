import { Router, type Request } from 'express';
import { z } from 'zod';
import type { createFavouriteRepo } from '../db/favouriteRepo.js';

const addSchema = z.object({
  videoId: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  kind: z.enum(['yt', 'lib']).optional(),
});

export function createFavouriteRouter(favouriteRepo: ReturnType<typeof createFavouriteRepo>): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const userId = (req as Request & { userId?: string }).userId;
    if (!userId) return res.status(401).json({ error: 'Log in to view favourites.' });
    res.json({ favourites: await favouriteRepo.listByUser(userId) });
  });

  router.post('/', async (req, res) => {
    const userId = (req as Request & { userId?: string }).userId;
    if (!userId) return res.status(401).json({ error: 'Log in to save favourites.' });
    const parsed = addSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid track.' });
    await favouriteRepo.add(userId, parsed.data.videoId, parsed.data.title, parsed.data.kind ?? 'yt');
    res.json({ ok: true });
  });

  router.delete('/:videoId', async (req, res) => {
    const userId = (req as Request & { userId?: string }).userId;
    if (!userId) return res.status(401).json({ error: 'Log in first.' });
    const ok = await favouriteRepo.remove(userId, req.params.videoId);
    if (!ok) return res.status(404).json({ error: 'Not in your favourites.' });
    res.json({ ok: true });
  });

  return router;
}
