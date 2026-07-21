import { Router, type Request } from 'express';
import type { createHistoryRepo } from '../db/historyRepo.js';

export function createHistoryRouter(historyRepo: ReturnType<typeof createHistoryRepo>): Router {
  const router = Router();
  router.get('/', async (req, res) => {
    const userId = (req as Request & { userId?: string }).userId;
    if (!userId) return res.status(401).json({ error: 'Log in to view history.' });
    res.json({ history: await historyRepo.listByUser(userId) });
  });
  return router;
}
