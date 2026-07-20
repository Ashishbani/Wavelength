import { Router, type Request } from 'express';
import type { createRoomRepo } from '../db/roomRepo.js';
import { createRoomSchema } from '../auth/validators.js';

function requireAuth(req: Request): string | null {
  return (req as Request & { userId?: string }).userId ?? null;
}

export function createRoomRouter(roomRepo: ReturnType<typeof createRoomRepo>, genCode: () => string): Router {
  const router = Router();

  router.post('/', (req, res) => {
    const userId = requireAuth(req);
    if (!userId) return res.status(401).json({ error: 'Log in to create a saved room.' });
    const parsed = createRoomSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid room name.' });
    let code = genCode();
    while (roomRepo.findByCode(code)) code = genCode();
    const room = roomRepo.create(userId, code, parsed.data.name);
    res.json({ code: room.code, name: room.name });
  });

  router.get('/', (req, res) => {
    const userId = requireAuth(req);
    if (!userId) return res.status(401).json({ error: 'Log in to view saved rooms.' });
    res.json({ rooms: roomRepo.listByOwner(userId).map((r) => ({ code: r.code, name: r.name })) });
  });

  router.delete('/:code', (req, res) => {
    const userId = requireAuth(req);
    if (!userId) return res.status(401).json({ error: 'Log in to delete a saved room.' });
    const ok = roomRepo.deleteByCode(req.params.code.toUpperCase(), userId);
    if (!ok) return res.status(404).json({ error: 'Room not found.' });
    res.json({ ok: true });
  });

  return router;
}
