import { Router, type Request } from 'express';
import type { createUserRepo } from '../db/userRepo.js';
import { usernameSchema, changePasswordSchema } from '../auth/validators.js';
import { hashPassword, verifyPassword } from '../auth/password.js';

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

  // Change password: proves knowledge of the current one before setting a new
  // one. (A "forgot password" email reset needs an email provider — until then,
  // a session on any signed-in device can change the password here.)
  router.put('/password', async (req, res) => {
    const userId = (req as Request & { userId?: string }).userId;
    if (!userId) return res.status(401).json({ error: 'Log in first.' });
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    const me = await userRepo.findWithHashById(userId);
    if (!me) return res.status(401).json({ error: 'Log in first.' });
    const ok = await verifyPassword(parsed.data.currentPassword, me.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });
    await userRepo.setPasswordHash(userId, await hashPassword(parsed.data.newPassword));
    res.json({ ok: true });
  });

  return router;
}
