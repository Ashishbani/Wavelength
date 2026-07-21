import { Router, type Request, type Response } from 'express';
import type { createUserRepo } from '../db/userRepo.js';
import { hashPassword, verifyPassword } from './password.js';
import { signToken } from './token.js';
import { registerSchema, loginSchema } from './validators.js';
import { createRateLimiter } from './rateLimit.js';

export const COOKIE_NAME = 'wl_token';

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    // Set COOKIE_SECURE=true when served over HTTPS (deploy / tunnel / domain).
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  };
}

export function createAuthRouter(userRepo: ReturnType<typeof createUserRepo>): Router {
  const router = Router();
  const limiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

  function limit(req: Request, res: Response): boolean {
    const key = req.ip ?? 'unknown';
    if (!limiter.check(key)) {
      res.status(429).json({ error: 'Too many attempts. Try again later.' });
      return false;
    }
    return true;
  }

  router.post('/register', async (req, res) => {
    if (!limit(req, res)) return;
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid registration details.' });
    const { email, password, displayName } = parsed.data;
    try {
      const hash = await hashPassword(password);
      const user = await userRepo.create(email.toLowerCase(), hash, displayName);
      res.cookie(COOKIE_NAME, signToken({ userId: user.id }), cookieOptions());
      res.json({ id: user.id, email: user.email, displayName: user.displayName, username: user.username });
    } catch (e) {
      if ((e as Error).message === 'EMAIL_TAKEN') return res.status(409).json({ error: 'That email is already registered.' });
      res.status(500).json({ error: 'Registration failed.' });
    }
  });

  router.post('/login', async (req, res) => {
    if (!limit(req, res)) return;
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid login details.' });
    const { email, password } = parsed.data;
    const user = await userRepo.findByEmail(email.toLowerCase());
    const ok = user ? await verifyPassword(password, user.passwordHash) : false;
    if (!user || !ok) return res.status(401).json({ error: 'Invalid email or password' });
    res.cookie(COOKIE_NAME, signToken({ userId: user.id }), cookieOptions());
    res.json({ id: user.id, email: user.email, displayName: user.displayName, username: user.username });
  });

  router.post('/logout', (_req, res) => {
    res.clearCookie(COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
  });

  router.get('/me', async (req, res) => {
    const userId = (req as Request & { userId?: string }).userId;
    if (!userId) return res.json({ user: null });
    const user = await userRepo.findById(userId);
    res.json({ user: user ? { id: user.id, email: user.email, displayName: user.displayName, username: user.username } : null });
  });

  return router;
}
