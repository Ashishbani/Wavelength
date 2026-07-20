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
  function requireHandle(req: Request, res: Response): { userId: string; username: string } | null {
    const userId = authed(req);
    if (!userId) { res.status(401).json({ error: 'Log in first.' }); return null; }
    const me = userRepo.findById(userId);
    if (!me?.username) { res.status(409).json({ error: 'Choose a handle first.', code: 'NEEDS_HANDLE' }); return null; }
    return { userId, username: me.username };
  }

  router.get('/', (req, res) => {
    const ctx = requireHandle(req, res); if (!ctx) return;
    res.json({ friends: friendRepo.listFriends(ctx.userId) });
  });

  router.get('/requests', (req, res) => {
    const ctx = requireHandle(req, res); if (!ctx) return;
    res.json({ incoming: friendRepo.listIncoming(ctx.userId), outgoing: friendRepo.listOutgoing(ctx.userId) });
  });

  router.post('/requests', (req, res) => {
    const ctx = requireHandle(req, res); if (!ctx) return;
    const parsed = friendRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid handle.' });
    const target = userRepo.findByUsername(parsed.data.username);
    if (!target) return res.status(404).json({ error: 'No user with that handle.' });
    try {
      friendRepo.sendRequest(ctx.userId, target.id);
      const me = userRepo.findById(ctx.userId)!;
      onRequest(target.id, me.username ?? '', me.displayName);
      res.json({ ok: true });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'SELF') return res.status(400).json({ error: "You can't friend yourself." });
      if (msg === 'EDGE_EXISTS') return res.status(409).json({ error: 'Already friends or request pending.' });
      res.status(500).json({ error: 'Could not send request.' });
    }
  });

  router.post('/requests/:id/accept', (req, res) => {
    const ctx = requireHandle(req, res); if (!ctx) return;
    if (!friendRepo.accept(req.params.id, ctx.userId)) return res.status(404).json({ error: 'Request not found.' });
    res.json({ ok: true });
  });

  router.post('/requests/:id/decline', (req, res) => {
    const ctx = requireHandle(req, res); if (!ctx) return;
    if (!friendRepo.decline(req.params.id, ctx.userId)) return res.status(404).json({ error: 'Request not found.' });
    res.json({ ok: true });
  });

  router.delete('/:userId', (req, res) => {
    const ctx = requireHandle(req, res); if (!ctx) return;
    if (!friendRepo.unfriend(ctx.userId, req.params.userId)) return res.status(404).json({ error: 'Not friends.' });
    res.json({ ok: true });
  });

  return router;
}
