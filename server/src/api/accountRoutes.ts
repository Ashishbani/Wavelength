import { Router, type Request } from 'express';
import type { createUserRepo } from '../db/userRepo.js';
import { usernameSchema } from '../auth/validators.js';

export function createAccountRouter(userRepo: ReturnType<typeof createUserRepo>): Router {
  const router = Router();

  router.put('/username', async (req, res) => {
    const userId = (req as Request & { userId?: string }).userId;
    if (!userId) return res.status(401).json({ error: 'Log in first.' });
    const parsed = usernameSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Handles are 3–20 letters, numbers, or underscores.' });
    try {
      await userRepo.setUsername(userId, parsed.data.username);
      res.json({ username: parsed.data.username.toLowerCase() });
    } catch (e) {
      if ((e as Error).message === 'USERNAME_TAKEN') return res.status(409).json({ error: 'That handle is taken.' });
      res.status(500).json({ error: 'Could not set handle.' });
    }
  });

  return router;
}
