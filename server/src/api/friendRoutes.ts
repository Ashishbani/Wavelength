import { Router, type Request, type Response } from 'express';
import type { createUserRepo } from '../db/userRepo.js';
import type { createFriendRepo } from '../db/friendRepo.js';
import { friendRequestSchema } from '../auth/validators.js';

function authed(req: Request): string | null {
  return (req as Request & { userId?: string }).userId ?? null;
}

export function createFriendRouter(
  userRepo: ReturnType<typeof createUserRepo>,
  friendRepo: ReturnType<typeof createFriendRepo>,
  onRequest: (addresseeId: string, fromUsername: string, fromDisplayName: string) => void,
): Router {
  const router = Router();

  // Require the caller to have a handle before using social features.
  async function requireHandle(req: Request, res: Response): Promise<{ userId: string; username: string } | null> {
    const userId = authed(req);
    if (!userId) { res.status(401).json({ error: 'Log in first.' }); return null; }
    const me = await userRepo.findById(userId);
    if (!me?.username) { res.status(409).json({ error: 'Choose a handle first.', code: 'NEEDS_HANDLE' }); return null; }
    return { userId, username: me.username };
  }

  router.get('/', async (req, res) => {
    const ctx = await requireHandle(req, res); if (!ctx) return;
    res.json({ friends: await friendRepo.listFriends(ctx.userId) });
  });

  router.get('/requests', async (req, res) => {
    const ctx = await requireHandle(req, res); if (!ctx) return;
    const [incoming, outgoing] = await Promise.all([friendRepo.listIncoming(ctx.userId), friendRepo.listOutgoing(ctx.userId)]);
    res.json({ incoming, outgoing });
  });

  router.post('/requests', async (req, res) => {
    const ctx = await requireHandle(req, res); if (!ctx) return;
    const parsed = friendRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid handle.' });
    const target = await userRepo.findByUsername(parsed.data.username);
    if (!target) return res.status(404).json({ error: 'No user with that handle.' });
    try {
      await friendRepo.sendRequest(ctx.userId, target.id);
      const me = (await userRepo.findById(ctx.userId))!;
      onRequest(target.id, me.username ?? '', me.displayName);
      res.json({ ok: true });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'SELF') return res.status(400).json({ error: "You can't friend yourself." });
      if (msg === 'EDGE_EXISTS') return res.status(409).json({ error: 'Already friends or request pending.' });
      res.status(500).json({ error: 'Could not send request.' });
    }
  });

  router.post('/requests/:id/accept', async (req, res) => {
    const ctx = await requireHandle(req, res); if (!ctx) return;
    if (!(await friendRepo.accept(req.params.id, ctx.userId))) return res.status(404).json({ error: 'Request not found.' });
    res.json({ ok: true });
  });

  router.post('/requests/:id/decline', async (req, res) => {
    const ctx = await requireHandle(req, res); if (!ctx) return;
    if (!(await friendRepo.decline(req.params.id, ctx.userId))) return res.status(404).json({ error: 'Request not found.' });
    res.json({ ok: true });
  });

  router.delete('/:userId', async (req, res) => {
    const ctx = await requireHandle(req, res); if (!ctx) return;
    if (!(await friendRepo.unfriend(ctx.userId, req.params.userId))) return res.status(404).json({ error: 'Not friends.' });
    res.json({ ok: true });
  });

  return router;
}
