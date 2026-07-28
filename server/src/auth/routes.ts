import { randomInt } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import type { createUserRepo } from '../db/userRepo.js';
import type { createResetRepo } from '../db/resetRepo.js';
import { hashPassword, verifyPassword } from './password.js';
import { signToken } from './token.js';
import { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema } from './validators.js';
import { createRateLimiter } from './rateLimit.js';
import type { SendMail } from './mailer.js';

const RESET_TTL_MS = 10 * 60 * 1000;
const RESET_MAX_ATTEMPTS = 5;

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

export function createAuthRouter(
  userRepo: ReturnType<typeof createUserRepo>,
  resetRepo?: ReturnType<typeof createResetRepo>,
  sendMail?: SendMail | null,
): Router {
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

  // Step 1 of forgot-password: email a 6-digit code. The response is the same
  // whether or not the account exists, so emails can't be enumerated.
  router.post('/forgot', async (req, res) => {
    if (!limit(req, res)) return;
    if (!resetRepo || !sendMail) {
      return res.status(503).json({ error: 'Password reset by email is not set up on this server yet.' });
    }
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email address.' });
    const generic = { ok: true, message: 'If an account exists for that email, a code is on its way.' };
    const user = await userRepo.findByEmail(parsed.data.email.toLowerCase());
    if (!user) return res.json(generic);
    try {
      const code = String(randomInt(100000, 1000000)); // 6 digits
      await resetRepo.create(user.id, await hashPassword(code), Date.now() + RESET_TTL_MS);
      await sendMail(
        user.email,
        'Your Wavelength password reset code',
        `Hi ${user.displayName},\n\nYour password reset code is: ${code}\n\nIt expires in 10 minutes. If you didn't request this, you can ignore this email.`,
      );
      res.json(generic);
    } catch {
      res.status(502).json({ error: 'Could not send the email right now. Try again in a minute.' });
    }
  });

  // Step 2: exchange the emailed code for a new password.
  router.post('/reset', async (req, res) => {
    if (!limit(req, res)) return;
    if (!resetRepo) return res.status(503).json({ error: 'Password reset by email is not set up on this server yet.' });
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Check the code (6 digits) and that the new password has 8+ characters.' });
    const user = await userRepo.findByEmail(parsed.data.email.toLowerCase());
    const invalid = () => res.status(400).json({ error: 'That code is invalid or has expired.' });
    if (!user) return invalid();
    const reset = await resetRepo.findActiveByUserId(user.id);
    if (!reset) return invalid();
    const attempts = await resetRepo.incrementAttempts(reset.id);
    if (attempts > RESET_MAX_ATTEMPTS) {
      await resetRepo.deleteForUser(user.id);
      return res.status(429).json({ error: 'Too many attempts — request a new code.' });
    }
    if (!(await verifyPassword(parsed.data.code, reset.codeHash))) return invalid();
    await userRepo.setPasswordHash(user.id, await hashPassword(parsed.data.newPassword));
    await resetRepo.deleteForUser(user.id);
    res.json({ ok: true });
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
