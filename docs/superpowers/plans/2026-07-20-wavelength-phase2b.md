# Wavelength Phase 2b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add mutual friendships, real-time presence, one-click join, and host-initiated invites to Wavelength, on top of the Phase 2a account system.

**Architecture:** A `friend_edges` table (via the existing SQLite repo layer) stores requests/friendships; a pure in-memory `PresenceRegistry` tracks who is online and their current room. Each authed socket joins a `user:<id>` room so the server can push presence, friend-request, and invite events to a specific user across tabs.

**Tech Stack:** TypeScript, Express, Socket.IO, better-sqlite3, zod, React + Vite, Vitest (all already in the project).

## Global Constraints

- **Language/module:** TypeScript, ESM, `strict: true`, Node 20+.
- **Accounts required for social features:** all endpoints/events here require an authed user; guests/logged-out users are unaffected.
- **Handles:** `users.username` unique, case-insensitive, format `^[A-Za-z0-9_]{3,20}$`, stored lowercased. Users without a handle are gated with a `409 { error, code: 'NEEDS_HANDLE' }`.
- **Relationship rules (server re-checked on every action):** no self-request; no duplicate edge in either direction; only the addressee may accept/decline; only friends may be invited; presence is friends-only.
- **Security:** zod on `PUT /api/account/username`, `POST /api/friends/requests`, and `invite:send`; all SQL via prepared statements with bound parameters.
- **Addressing:** each authed socket joins room `user:<userId>`; user-targeted events are emitted with `io.to(\`user:<id>\`)`.
- **Shared event name:** `PresenceInfo = { userId: string; online: boolean; roomCode: string | null }`.

---

### Task 1: Handles — userRepo username support + migration

**Files:**
- Modify: `server/src/db/db.ts` (migrate: add username column + unique index)
- Modify: `server/src/db/userRepo.ts` (username in `User`, `setUsername`, `findByUsername`)
- Test: `server/src/db/userRepo.test.ts` (add username cases)

**Interfaces:**
- Produces: `User` gains `username: string | null`. `createUserRepo(db)` gains
  `setUsername(userId: string, username: string): void` (throws `'USERNAME_TAKEN'` on unique violation) and `findByUsername(username: string): User | null` (case-insensitive).

- [ ] **Step 1: Extend `migrate` in `server/src/db/db.ts`**

At the end of `migrate(db)`, after the `db.exec(...)` block, add:

```ts
  const cols = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'username')) {
    db.exec('ALTER TABLE users ADD COLUMN username TEXT');
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE)');
```

- [ ] **Step 2: Add username to `User` and methods in `server/src/db/userRepo.ts`**

Update the `User` interface and row type, and the mappers, to include username; add two methods. The full updated file:

```ts
import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';

export interface User {
  id: string;
  email: string;
  displayName: string;
  username: string | null;
  createdAt: number;
}

export interface UserWithHash extends User {
  passwordHash: string;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  username: string | null;
  created_at: number;
}

export function createUserRepo(db: DB) {
  const insert = db.prepare(
    'INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const byEmail = db.prepare('SELECT * FROM users WHERE email = ?');
  const byId = db.prepare('SELECT * FROM users WHERE id = ?');
  const byUsername = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE');
  const setName = db.prepare('UPDATE users SET username = ? WHERE id = ?');

  function toUser(row: UserRow): User {
    return { id: row.id, email: row.email, displayName: row.display_name, username: row.username ?? null, createdAt: row.created_at };
  }

  return {
    create(email: string, passwordHash: string, displayName: string): User {
      const id = randomUUID();
      const createdAt = Date.now();
      try {
        insert.run(id, email, passwordHash, displayName, createdAt);
      } catch (e) {
        if (String((e as Error).message).includes('UNIQUE')) throw new Error('EMAIL_TAKEN');
        throw e;
      }
      return { id, email, displayName, username: null, createdAt };
    },
    findByEmail(email: string): UserWithHash | null {
      const row = byEmail.get(email) as UserRow | undefined;
      if (!row) return null;
      return { ...toUser(row), passwordHash: row.password_hash };
    },
    findById(id: string): User | null {
      const row = byId.get(id) as UserRow | undefined;
      return row ? toUser(row) : null;
    },
    findByUsername(username: string): User | null {
      const row = byUsername.get(username.toLowerCase()) as UserRow | undefined;
      return row ? toUser(row) : null;
    },
    setUsername(userId: string, username: string): void {
      try {
        setName.run(username.toLowerCase(), userId);
      } catch (e) {
        if (String((e as Error).message).includes('UNIQUE')) throw new Error('USERNAME_TAKEN');
        throw e;
      }
    },
  };
}
```

- [ ] **Step 3: Add username test cases to `server/src/db/userRepo.test.ts`**

Append inside the `describe('userRepo', ...)` block:

```ts
  it('sets and finds a user by username (case-insensitive)', () => {
    const u = repo.create('a@b.com', 'h', 'Alice');
    repo.setUsername(u.id, 'AliceCat');
    expect(repo.findByUsername('alicecat')?.id).toBe(u.id);
    expect(repo.findById(u.id)?.username).toBe('alicecat');
  });

  it('rejects a duplicate username', () => {
    const a = repo.create('a@b.com', 'h', 'Alice');
    const b = repo.create('b@b.com', 'h', 'Bob');
    repo.setUsername(a.id, 'dj');
    expect(() => repo.setUsername(b.id, 'DJ')).toThrow('USERNAME_TAKEN');
  });
```

- [ ] **Step 4: Run tests**

Run: `npm run test --workspace server`
Expected: userRepo tests (incl. new username cases) PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add username/handle support to userRepo and migration"
```

---

### Task 2: friendRepo (friend_edges)

**Files:**
- Modify: `server/src/db/db.ts` (create `friend_edges` table)
- Create: `server/src/db/friendRepo.ts`
- Test: `server/src/db/friendRepo.test.ts`

**Interfaces:**
- Produces: `interface FriendSummary { userId: string; username: string | null; displayName: string }`; `interface PendingRequest { id: string; userId: string; username: string | null; displayName: string }`; `createFriendRepo(db)` returning:
  - `sendRequest(requesterId: string, addresseeId: string): void` — throws `'SELF'` if same, `'EDGE_EXISTS'` if any edge exists in either direction.
  - `accept(id: string, addresseeId: string): boolean` — true if a pending row addressed to `addresseeId` moved to accepted.
  - `decline(id: string, addresseeId: string): boolean` — true if a pending row addressed to `addresseeId` was deleted.
  - `listFriends(userId: string): FriendSummary[]`
  - `listIncoming(userId: string): PendingRequest[]` · `listOutgoing(userId: string): PendingRequest[]`
  - `areFriends(a: string, b: string): boolean`
  - `unfriend(a: string, b: string): boolean`
  - `friendIds(userId: string): string[]`

- [ ] **Step 1: Add the `friend_edges` table to `migrate` in `server/src/db/db.ts`**

Add to the `db.exec(...)` template (with the other `CREATE TABLE IF NOT EXISTS`):

```sql
    CREATE TABLE IF NOT EXISTS friend_edges (
      id TEXT PRIMARY KEY,
      requester_id TEXT NOT NULL,
      addressee_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (requester_id, addressee_id),
      FOREIGN KEY (requester_id) REFERENCES users(id),
      FOREIGN KEY (addressee_id) REFERENCES users(id)
    );
```

- [ ] **Step 2: Write `server/src/db/friendRepo.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';

export interface FriendSummary {
  userId: string;
  username: string | null;
  displayName: string;
}

export interface PendingRequest {
  id: string;
  userId: string;
  username: string | null;
  displayName: string;
}

interface EdgeRow { id: string; requester_id: string; addressee_id: string; status: string; }
interface JoinRow { id: string; user_id: string; username: string | null; display_name: string; }

export function createFriendRepo(db: DB) {
  const anyEdge = db.prepare(
    'SELECT * FROM friend_edges WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)',
  );
  const insert = db.prepare('INSERT INTO friend_edges (id, requester_id, addressee_id, status, created_at) VALUES (?, ?, ?, ?, ?)');
  const pendingById = db.prepare("SELECT * FROM friend_edges WHERE id = ? AND status = 'pending'");
  const setAccepted = db.prepare("UPDATE friend_edges SET status = 'accepted' WHERE id = ?");
  const delById = db.prepare('DELETE FROM friend_edges WHERE id = ?');
  const delPair = db.prepare(
    "DELETE FROM friend_edges WHERE status = 'accepted' AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))",
  );
  const acceptedFor = db.prepare(`
    SELECT u.id AS user_id, u.username AS username, u.display_name AS display_name
    FROM friend_edges e
    JOIN users u ON u.id = CASE WHEN e.requester_id = ? THEN e.addressee_id ELSE e.requester_id END
    WHERE e.status = 'accepted' AND (e.requester_id = ? OR e.addressee_id = ?)
    ORDER BY u.display_name COLLATE NOCASE ASC
  `);
  const incoming = db.prepare(`
    SELECT e.id AS id, u.id AS user_id, u.username AS username, u.display_name AS display_name
    FROM friend_edges e JOIN users u ON u.id = e.requester_id
    WHERE e.addressee_id = ? AND e.status = 'pending'
  `);
  const outgoing = db.prepare(`
    SELECT e.id AS id, u.id AS user_id, u.username AS username, u.display_name AS display_name
    FROM friend_edges e JOIN users u ON u.id = e.addressee_id
    WHERE e.requester_id = ? AND e.status = 'pending'
  `);

  function toSummary(r: JoinRow): FriendSummary {
    return { userId: r.user_id, username: r.username ?? null, displayName: r.display_name };
  }
  function toPending(r: JoinRow): PendingRequest {
    return { id: r.id, userId: r.user_id, username: r.username ?? null, displayName: r.display_name };
  }

  return {
    sendRequest(requesterId: string, addresseeId: string): void {
      if (requesterId === addresseeId) throw new Error('SELF');
      const existing = anyEdge.get(requesterId, addresseeId, addresseeId, requesterId);
      if (existing) throw new Error('EDGE_EXISTS');
      insert.run(randomUUID(), requesterId, addresseeId, 'pending', Date.now());
    },
    accept(id: string, addresseeId: string): boolean {
      const row = pendingById.get(id) as EdgeRow | undefined;
      if (!row || row.addressee_id !== addresseeId) return false;
      setAccepted.run(id);
      return true;
    },
    decline(id: string, addresseeId: string): boolean {
      const row = pendingById.get(id) as EdgeRow | undefined;
      if (!row || row.addressee_id !== addresseeId) return false;
      delById.run(id);
      return true;
    },
    listFriends(userId: string): FriendSummary[] {
      return (acceptedFor.all(userId, userId, userId) as JoinRow[]).map(toSummary);
    },
    listIncoming(userId: string): PendingRequest[] {
      return (incoming.all(userId) as JoinRow[]).map(toPending);
    },
    listOutgoing(userId: string): PendingRequest[] {
      return (outgoing.all(userId) as JoinRow[]).map(toPending);
    },
    areFriends(a: string, b: string): boolean {
      const row = anyEdge.get(a, b, b, a) as EdgeRow | undefined;
      return !!row && row.status === 'accepted';
    },
    unfriend(a: string, b: string): boolean {
      return delPair.run(a, b, b, a).changes > 0;
    },
    friendIds(userId: string): string[] {
      return (acceptedFor.all(userId, userId, userId) as JoinRow[]).map((r) => r.user_id);
    },
  };
}
```

- [ ] **Step 3: Write `server/src/db/friendRepo.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrate, type DB } from './db.js';
import { createUserRepo } from './userRepo.js';
import { createFriendRepo } from './friendRepo.js';

describe('friendRepo', () => {
  let db: DB;
  let friends: ReturnType<typeof createFriendRepo>;
  let alice: string;
  let bob: string;
  beforeEach(() => {
    db = openDb(':memory:');
    migrate(db);
    const users = createUserRepo(db);
    alice = users.create('a@b.com', 'h', 'Alice').id;
    bob = users.create('b@b.com', 'h', 'Bob').id;
    users.setUsername(alice, 'alice');
    users.setUsername(bob, 'bob');
    friends = createFriendRepo(db);
  });

  it('sends, lists, and accepts a request into a friendship', () => {
    friends.sendRequest(alice, bob);
    expect(friends.listOutgoing(alice)).toHaveLength(1);
    const incoming = friends.listIncoming(bob);
    expect(incoming[0].username).toBe('alice');
    expect(friends.accept(incoming[0].id, bob)).toBe(true);
    expect(friends.areFriends(alice, bob)).toBe(true);
    expect(friends.listFriends(alice).map((f) => f.userId)).toEqual([bob]);
    expect(friends.friendIds(bob)).toEqual([alice]);
  });

  it('rejects self-request and duplicate/reverse edges', () => {
    expect(() => friends.sendRequest(alice, alice)).toThrow('SELF');
    friends.sendRequest(alice, bob);
    expect(() => friends.sendRequest(alice, bob)).toThrow('EDGE_EXISTS');
    expect(() => friends.sendRequest(bob, alice)).toThrow('EDGE_EXISTS');
  });

  it('only the addressee can accept', () => {
    friends.sendRequest(alice, bob);
    const id = friends.listIncoming(bob)[0].id;
    expect(friends.accept(id, alice)).toBe(false);
    expect(friends.accept(id, bob)).toBe(true);
  });

  it('declines a request and allows unfriending', () => {
    friends.sendRequest(alice, bob);
    const id = friends.listIncoming(bob)[0].id;
    expect(friends.decline(id, bob)).toBe(true);
    expect(friends.areFriends(alice, bob)).toBe(false);

    friends.sendRequest(alice, bob);
    const id2 = friends.listIncoming(bob)[0].id;
    friends.accept(id2, bob);
    expect(friends.unfriend(bob, alice)).toBe(true);
    expect(friends.areFriends(alice, bob)).toBe(false);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npm run test --workspace server`
Expected: friendRepo tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add friendRepo with request lifecycle and friendship queries"
```

---

### Task 3: PresenceRegistry (pure)

**Files:**
- Create: `server/src/presence/presenceRegistry.ts`
- Test: `server/src/presence/presenceRegistry.test.ts`

**Interfaces:**
- Produces: `class PresenceRegistry` with `addSocket(userId, socketId): void`; `removeSocket(userId, socketId): { nowOffline: boolean }`; `setRoom(userId, roomCode: string | null): void`; `isOnline(userId): boolean`; `getPresence(userId): { online: boolean; roomCode: string | null }`.

- [ ] **Step 1: Write `server/src/presence/presenceRegistry.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PresenceRegistry } from './presenceRegistry.js';

describe('PresenceRegistry', () => {
  let p: PresenceRegistry;
  beforeEach(() => { p = new PresenceRegistry(); });

  it('marks a user online while any socket is connected', () => {
    p.addSocket('u1', 's1');
    p.addSocket('u1', 's2');
    expect(p.isOnline('u1')).toBe(true);
    expect(p.removeSocket('u1', 's1').nowOffline).toBe(false);
    expect(p.isOnline('u1')).toBe(true);
    expect(p.removeSocket('u1', 's2').nowOffline).toBe(true);
    expect(p.isOnline('u1')).toBe(false);
  });

  it('tracks and clears the current room', () => {
    p.addSocket('u1', 's1');
    p.setRoom('u1', 'ABC123');
    expect(p.getPresence('u1')).toEqual({ online: true, roomCode: 'ABC123' });
    p.setRoom('u1', null);
    expect(p.getPresence('u1')).toEqual({ online: true, roomCode: null });
  });

  it('reports offline presence for unknown users', () => {
    expect(p.getPresence('nobody')).toEqual({ online: false, roomCode: null });
  });

  it('drops room when the user goes offline', () => {
    p.addSocket('u1', 's1');
    p.setRoom('u1', 'ABC123');
    p.removeSocket('u1', 's1');
    expect(p.getPresence('u1')).toEqual({ online: false, roomCode: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace server`
Expected: FAIL — cannot find `./presenceRegistry.js`.

- [ ] **Step 3: Write `server/src/presence/presenceRegistry.ts`**

```ts
interface Entry {
  socketIds: Set<string>;
  roomCode: string | null;
}

export class PresenceRegistry {
  private entries = new Map<string, Entry>();

  addSocket(userId: string, socketId: string): void {
    const e = this.entries.get(userId);
    if (e) e.socketIds.add(socketId);
    else this.entries.set(userId, { socketIds: new Set([socketId]), roomCode: null });
  }

  removeSocket(userId: string, socketId: string): { nowOffline: boolean } {
    const e = this.entries.get(userId);
    if (!e) return { nowOffline: false };
    e.socketIds.delete(socketId);
    if (e.socketIds.size === 0) {
      this.entries.delete(userId);
      return { nowOffline: true };
    }
    return { nowOffline: false };
  }

  setRoom(userId: string, roomCode: string | null): void {
    const e = this.entries.get(userId);
    if (e) e.roomCode = roomCode;
  }

  isOnline(userId: string): boolean {
    return this.entries.has(userId);
  }

  getPresence(userId: string): { online: boolean; roomCode: string | null } {
    const e = this.entries.get(userId);
    return e ? { online: true, roomCode: e.roomCode } : { online: false, roomCode: null };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace server`
Expected: PresenceRegistry tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add pure in-memory PresenceRegistry"
```

---

### Task 4: Account + friend REST routes

**Files:**
- Create: `server/src/api/accountRoutes.ts`
- Create: `server/src/api/friendRoutes.ts`
- Modify: `server/src/auth/validators.ts` (add schemas)
- Modify: `server/src/auth/routes.ts` (include `username` in `/me`)
- Modify: `server/src/index.ts` (mount routes; pass a request-notifier)
- Test: `server/src/api/friendRoutes.test.ts`

**Interfaces:**
- Consumes: `createUserRepo`, `createFriendRepo`.
- Produces:
  - `validators.ts`: `usernameSchema = z.object({ username: z.string().trim().min(3).max(20).regex(/^[A-Za-z0-9_]+$/) })`; `friendRequestSchema = z.object({ username: z.string().trim().min(3).max(20) })`; `inviteSchema = z.object({ toUserId: z.string().min(1).max(64) })`.
  - `accountRoutes.ts`: `createAccountRouter(userRepo): Router` — `PUT /username`.
  - `friendRoutes.ts`: `createFriendRouter(userRepo, friendRepo, onRequest: (addresseeId: string, fromUsername: string, fromDisplayName: string) => void): Router`.

- [ ] **Step 1: Add schemas to `server/src/auth/validators.ts`**

Append:

```ts
export const usernameSchema = z.object({
  username: z.string().trim().min(3).max(20).regex(/^[A-Za-z0-9_]+$/),
});

export const friendRequestSchema = z.object({
  username: z.string().trim().min(3).max(20),
});

export const inviteSchema = z.object({
  toUserId: z.string().min(1).max(64),
});
```

- [ ] **Step 2: Include `username` in `/me` in `server/src/auth/routes.ts`**

Replace the `/me` handler's response line so it includes username:

```ts
  router.get('/me', (req, res) => {
    const userId = (req as Request & { userId?: string }).userId;
    if (!userId) return res.json({ user: null });
    const user = userRepo.findById(userId);
    res.json({ user: user ? { id: user.id, email: user.email, displayName: user.displayName, username: user.username } : null });
  });
```

- [ ] **Step 3: Write `server/src/api/accountRoutes.ts`**

```ts
import { Router, type Request } from 'express';
import type { createUserRepo } from '../db/userRepo.js';
import { usernameSchema } from '../auth/validators.js';

export function createAccountRouter(userRepo: ReturnType<typeof createUserRepo>): Router {
  const router = Router();

  router.put('/username', (req, res) => {
    const userId = (req as Request & { userId?: string }).userId;
    if (!userId) return res.status(401).json({ error: 'Log in first.' });
    const parsed = usernameSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Handles are 3–20 letters, numbers, or underscores.' });
    try {
      userRepo.setUsername(userId, parsed.data.username);
      res.json({ username: parsed.data.username.toLowerCase() });
    } catch (e) {
      if ((e as Error).message === 'USERNAME_TAKEN') return res.status(409).json({ error: 'That handle is taken.' });
      res.status(500).json({ error: 'Could not set handle.' });
    }
  });

  return router;
}
```

- [ ] **Step 4: Write `server/src/api/friendRoutes.ts`**

```ts
import { Router, type Request } from 'express';
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
  function requireHandle(req: Request, res: import('express').Response): { userId: string; username: string } | null {
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
```

- [ ] **Step 5: Wire routes into `server/src/index.ts`**

Add imports:

```ts
import { createFriendRepo } from './db/friendRepo.js';
import { createAccountRouter } from './api/accountRoutes.js';
import { createFriendRouter } from './api/friendRoutes.js';
```

After `const historyRepo = createHistoryRepo(db);` add:

```ts
  const friendRepo = createFriendRepo(db);
```

After the `/api/history` mount add (the notifier uses `io`, declared just below; define the mount after `io` is created OR use a late binding). To keep ordering simple, mount these right after `io` and `rooms` are created — move the four `app.use('/api/...')` lines is not required; instead declare the notifier as a function that references `io` (created later) and mount here:

```ts
  app.use('/api/account', createAccountRouter(userRepo));
  app.use('/api/friends', createFriendRouter(userRepo, friendRepo, (addresseeId, fromUsername, fromDisplayName) => {
    io.to(`user:${addresseeId}`).emit('friend:requestReceived', { fromUsername, fromDisplayName });
  }));
```

Because `io` is referenced inside the callback (not at mount time), and `io` is declared later in the same function scope with `const`, move these two `app.use` lines to **after** the `const io = new Server(...)` line. Place them immediately after `const rooms = new RoomManager();`.

- [ ] **Step 6: Write `server/src/api/friendRoutes.test.ts`**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { openDb, migrate } from '../db/db.js';
import { createServer } from '../index.js';

async function makeUser(base: string, email: string, displayName: string, username: string): Promise<string> {
  const reg = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password1', displayName }),
  });
  const cookie = reg.headers.get('set-cookie')!.split(';')[0];
  await fetch(`${base}/api/account/username`, {
    method: 'PUT', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ username }),
  });
  return cookie;
}

describe('friend routes', () => {
  let server: ReturnType<typeof createServer>;
  afterEach(async () => { await server.close(); });
  function start() {
    const db = openDb(':memory:'); migrate(db);
    server = createServer(0, db);
    return `http://localhost:${(server.httpServer.address() as { port: number }).port}`;
  }

  it('runs the full request → accept → friends lifecycle', async () => {
    const base = start();
    const aCookie = await makeUser(base, 'a@b.com', 'Alice', 'alice');
    const bCookie = await makeUser(base, 'b@b.com', 'Bob', 'bob');

    const send = await fetch(`${base}/api/friends/requests`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: aCookie }, body: JSON.stringify({ username: 'bob' }) });
    expect(send.status).toBe(200);

    const reqs = await (await fetch(`${base}/api/friends/requests`, { headers: { cookie: bCookie } })).json();
    expect(reqs.incoming).toHaveLength(1);
    const reqId = reqs.incoming[0].id;

    const accept = await fetch(`${base}/api/friends/requests/${reqId}/accept`, { method: 'POST', headers: { cookie: bCookie } });
    expect(accept.status).toBe(200);

    const aFriends = await (await fetch(`${base}/api/friends`, { headers: { cookie: aCookie } })).json();
    expect(aFriends.friends[0].username).toBe('bob');
  });

  it('gates social features until a handle is set', async () => {
    const base = start();
    const reg = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'c@b.com', password: 'password1', displayName: 'Cara' }) });
    const cookie = reg.headers.get('set-cookie')!.split(';')[0];
    const res = await fetch(`${base}/api/friends`, { headers: { cookie } });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('NEEDS_HANDLE');
  });

  it('rejects a duplicate friend request', async () => {
    const base = start();
    const aCookie = await makeUser(base, 'a@b.com', 'Alice', 'alice');
    await makeUser(base, 'b@b.com', 'Bob', 'bob');
    await fetch(`${base}/api/friends/requests`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: aCookie }, body: JSON.stringify({ username: 'bob' }) });
    const dup = await fetch(`${base}/api/friends/requests`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: aCookie }, body: JSON.stringify({ username: 'bob' }) });
    expect(dup.status).toBe(409);
  });
});
```

- [ ] **Step 7: Run tests**

Run: `npm run test --workspace server`
Expected: friend routes tests PASS; existing suites unaffected.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Add account handle and friend REST routes with request notifier"
```

---

### Task 5: Realtime presence + invites (shared events + socket wiring)

**Files:**
- Modify: `shared/src/events.ts` (PresenceInfo + new events)
- Modify: `server/src/index.ts` (presence bookkeeping + invite handler)
- Test: `server/src/presence.socket.test.ts`

**Interfaces:**
- Produces (shared): `interface PresenceInfo { userId: string; online: boolean; roomCode: string | null }`; `ClientToServerEvents` gains `'invite:send': (payload: { toUserId: string }) => void`; `ServerToClientEvents` gains `'presence:snapshot'`, `'presence:update'`, `'friend:requestReceived'`, `'invite:receive'` as specified in the design.

- [ ] **Step 1: Add events to `shared/src/events.ts`**

Add the interface (near `ChatMessage`):

```ts
export interface PresenceInfo {
  userId: string;
  online: boolean;
  roomCode: string | null;
}
```

Add to `ClientToServerEvents`:

```ts
  'invite:send': (payload: { toUserId: string }) => void;
```

Add to `ServerToClientEvents`:

```ts
  'presence:snapshot': (payload: { friends: PresenceInfo[] }) => void;
  'presence:update': (payload: PresenceInfo) => void;
  'friend:requestReceived': (payload: { fromUsername: string; fromDisplayName: string }) => void;
  'invite:receive': (payload: { fromDisplayName: string; code: string; roomName: string | null }) => void;
```

- [ ] **Step 2: Add presence wiring to `server/src/index.ts`**

Add imports:

```ts
import { PresenceRegistry } from './presence/presenceRegistry.js';
import { inviteSchema } from './auth/validators.js';
import type { PresenceInfo } from '@wavelength/shared';
```

After `const rooms = new RoomManager();` add:

```ts
  const presence = new PresenceRegistry();

  function pushPresenceToFriends(userId: string) {
    const info: PresenceInfo = { userId, ...presence.getPresence(userId) };
    for (const fid of friendRepo.friendIds(userId)) {
      if (presence.isOnline(fid)) io.to(`user:${fid}`).emit('presence:update', info);
    }
  }
```

In the `io.use((socket, next) => {...})` block you already set `socket.data.userId`. After that middleware, inside `io.on('connection', (socket) => {...})`, at the very top add presence registration for authed sockets:

```ts
    const uid = (socket.data as { userId?: string }).userId;
    if (uid) {
      socket.join(`user:${uid}`);
      presence.addSocket(uid, socket.id);
      pushPresenceToFriends(uid);
      const friends = friendRepo.friendIds(uid).map((fid): PresenceInfo => ({ userId: fid, ...presence.getPresence(fid) }));
      socket.emit('presence:snapshot', { friends });
    }
```

In `room:create` success (after `socket.join(state.code)`), add:

```ts
      if (uid) { presence.setRoom(uid, state.code); pushPresenceToFriends(uid); }
```

In `room:join` success (after `socket.join(upper)` and the `cb(...)`), add:

```ts
        if (uid) { presence.setRoom(uid, upper); pushPresenceToFriends(uid); }
```

Add the invite handler (inside `io.on('connection', ...)`):

```ts
    socket.on('invite:send', (payload) => {
      const parsed = inviteSchema.safeParse(payload);
      if (!parsed.success || !uid) return;
      const room = rooms.getRoomByMember(socket.id);
      if (!room || !rooms.isHost(room.code, socket.id)) return;
      if (!friendRepo.areFriends(uid, parsed.data.toUserId)) return;
      const roomName = roomRepo.findByCode(room.code)?.name ?? null;
      io.to(`user:${parsed.data.toUserId}`).emit('invite:receive', {
        fromDisplayName: nameOf(socket.id, room.code),
        code: room.code,
        roomName,
      });
    });
```

Update the `disconnect` handler to clear presence:

```ts
    socket.on('disconnect', () => {
      const res = rooms.leaveRoom(socket.id);
      if (res?.state) io.to(res.code).emit('room:state', res.state);
      if (uid) {
        const { nowOffline } = presence.removeSocket(uid, socket.id);
        if (nowOffline) pushPresenceToFriends(uid);
      }
    });
```

- [ ] **Step 3: Write `server/src/presence.socket.test.ts`**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import { openDb, migrate, type DB } from './db/db.js';
import { createServer } from './index.js';
import { createUserRepo } from './db/userRepo.js';
import { createFriendRepo } from './db/friendRepo.js';
import { signToken } from './auth/token.js';
import { COOKIE_NAME } from './auth/routes.js';
import type { CreateJoinResult, PresenceInfo } from '@wavelength/shared';

describe('presence + invites over sockets', () => {
  let server: ReturnType<typeof createServer>;
  const sockets: Socket[] = [];
  afterEach(async () => { sockets.forEach((s) => s.close()); sockets.length = 0; await server.close(); });

  function seedFriends(db: DB): { alice: string; bob: string } {
    const users = createUserRepo(db);
    const friends = createFriendRepo(db);
    const alice = users.create('a@b.com', 'h', 'Alice').id;
    const bob = users.create('b@b.com', 'h', 'Bob').id;
    users.setUsername(alice, 'alice');
    users.setUsername(bob, 'bob');
    friends.sendRequest(alice, bob);
    const inc = friends.listIncoming(bob)[0];
    friends.accept(inc.id, bob);
    return { alice, bob };
  }

  function connect(port: number, userId: string): Promise<Socket> {
    const token = signToken({ userId });
    return new Promise((resolve) => {
      const s = ioc(`http://localhost:${port}`, { transports: ['websocket'], extraHeaders: { cookie: `${COOKIE_NAME}=${token}` } });
      s.on('connect', () => resolve(s));
    });
  }

  it('notifies a friend when the other joins a room, and delivers invites', async () => {
    const db = openDb(':memory:'); migrate(db);
    const { alice, bob } = seedFriends(db);
    server = createServer(0, db);
    const port = (server.httpServer.address() as { port: number }).port;

    const aSock = await connect(port, alice); sockets.push(aSock);
    const bSock = await connect(port, bob); sockets.push(bSock);

    // Alice hosts a room; Bob should receive a presence:update carrying the code.
    const presenceP = new Promise<PresenceInfo>((r) => bSock.on('presence:update', (info) => { if (info.userId === alice && info.roomCode) r(info); }));
    const created = await new Promise<CreateJoinResult>((r) => aSock.emit('room:create', { name: 'Alice' }, r));
    if (!created.ok) throw new Error('create failed');
    const info = await presenceP;
    expect(info.roomCode).toBe(created.state.code);

    // Alice invites Bob; Bob receives invite:receive with the code.
    const inviteP = new Promise<{ code: string; fromDisplayName: string }>((r) => bSock.on('invite:receive', r));
    aSock.emit('invite:send', { toUserId: bob });
    const invite = await inviteP;
    expect(invite.code).toBe(created.state.code);
    expect(invite.fromDisplayName).toBe('Alice');
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npm run test --workspace server`
Expected: presence socket tests PASS; all prior suites still PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add realtime presence fan-out and direct room invites"
```

---

### Task 6: Client — auth username, handle prompt, presence hook, API

**Files:**
- Modify: `client/src/auth/AuthContext.tsx` (`AuthUser.username`, `refresh`, `setUsername`)
- Create: `client/src/friends/api.ts`
- Create: `client/src/friends/usePresence.ts`
- Modify: `client/src/auth/AuthPanel.tsx` (show handle when set)

**Interfaces:**
- Produces:
  - `AuthUser` gains `username: string | null`; `useAuth()` gains `setUsername(username: string): Promise<void>` and `refresh(): Promise<void>`.
  - `friends/api.ts`: types `FriendSummary`, `PendingRequest` and functions `getFriends()`, `getRequests()`, `sendRequest(username)`, `acceptRequest(id)`, `declineRequest(id)`, `unfriend(userId)`.
  - `usePresence.ts`: `usePresence(): Map<string, { online: boolean; roomCode: string | null }>` (keyed by userId; seeded by `presence:snapshot`, updated by `presence:update`).

- [ ] **Step 1: Extend `AuthUser` and `useAuth` in `client/src/auth/AuthContext.tsx`**

Update `AuthUser` and add `setUsername`/`refresh`:

```tsx
export interface AuthUser { id: string; email: string; displayName: string; username: string | null; }
```

Add inside `AuthProvider` (and to the `AuthValue` interface + provider value):

```tsx
  async function refresh() {
    const r = await apiGet<{ user: AuthUser | null }>('/api/auth/me');
    setUser(r.user);
  }
  async function setUsername(username: string) {
    await apiPut('/api/account/username', { username });
    await refresh();
  }
```

Add `refresh(): Promise<void>` and `setUsername(username: string): Promise<void>` to the `AuthValue` interface, and include both in the `<Ctx.Provider value={{ ... }}>`.

- [ ] **Step 2: Add `apiPut` to `client/src/auth/api.ts`**

```ts
export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return fetch(`${BASE}${path}`, {
    method: 'PUT', credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(handle<T>);
}
```

And import it where needed in `AuthContext.tsx`: `import { apiGet, apiPost, apiPut } from './api.js';`.

- [ ] **Step 3: Write `client/src/friends/api.ts`**

```ts
import { apiGet, apiPost, apiDelete } from '../auth/api.js';

export interface FriendSummary { userId: string; username: string | null; displayName: string; }
export interface PendingRequest { id: string; userId: string; username: string | null; displayName: string; }

export const getFriends = () => apiGet<{ friends: FriendSummary[] }>('/api/friends');
export const getRequests = () => apiGet<{ incoming: PendingRequest[]; outgoing: PendingRequest[] }>('/api/friends/requests');
export const sendRequest = (username: string) => apiPost('/api/friends/requests', { username });
export const acceptRequest = (id: string) => apiPost(`/api/friends/requests/${id}/accept`, {});
export const declineRequest = (id: string) => apiPost(`/api/friends/requests/${id}/decline`, {});
export const unfriend = (userId: string) => apiDelete(`/api/friends/${userId}`);
```

- [ ] **Step 4: Write `client/src/friends/usePresence.ts`**

```ts
import { useEffect, useState } from 'react';
import type { PresenceInfo } from '@wavelength/shared';
import socket from '../socket.js';

export interface PresenceState { online: boolean; roomCode: string | null; }

export function usePresence(): Map<string, PresenceState> {
  const [map, setMap] = useState<Map<string, PresenceState>>(new Map());

  useEffect(() => {
    function snapshot({ friends }: { friends: PresenceInfo[] }) {
      setMap(new Map(friends.map((f) => [f.userId, { online: f.online, roomCode: f.roomCode }])));
    }
    function update(info: PresenceInfo) {
      setMap((prev) => {
        const next = new Map(prev);
        next.set(info.userId, { online: info.online, roomCode: info.roomCode });
        return next;
      });
    }
    socket.on('presence:snapshot', snapshot);
    socket.on('presence:update', update);
    return () => { socket.off('presence:snapshot', snapshot); socket.off('presence:update', update); };
  }, []);

  return map;
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --workspace client`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add client username/handle support, friends API, and presence hook"
```

---

### Task 7: Client — FriendsPanel, toasts, and room invites

**Files:**
- Create: `client/src/friends/FriendsPanel.tsx`
- Create: `client/src/friends/Toasts.tsx`
- Modify: `client/src/Landing.tsx` (render FriendsPanel + Toasts; join from presence/invite)
- Modify: `client/src/Room.tsx` (host invite control)
- Modify: `client/src/styles.css`

**Interfaces:**
- Consumes: `useAuth`, `usePresence`, friends API, `socket`.
- Produces: `FriendsPanel` with prop `onJoin(code: string): void`; `Toasts` (self-contained, listens for `friend:requestReceived` and `invite:receive`) with prop `onJoin(code: string): void`.

- [ ] **Step 1: Write `client/src/friends/FriendsPanel.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.js';
import { usePresence } from './usePresence.js';
import { getFriends, getRequests, sendRequest, acceptRequest, declineRequest, unfriend, type FriendSummary, type PendingRequest } from './api.js';
import { ApiError } from '../auth/api.js';

export default function FriendsPanel({ onJoin }: { onJoin: (code: string) => void }) {
  const { user, setUsername } = useAuth();
  const presence = usePresence();
  const [friends, setFriends] = useState<FriendSummary[]>([]);
  const [incoming, setIncoming] = useState<PendingRequest[]>([]);
  const [outgoing, setOutgoing] = useState<PendingRequest[]>([]);
  const [handle, setHandle] = useState('');
  const [addName, setAddName] = useState('');
  const [error, setError] = useState('');

  async function refreshAll() {
    try {
      const [f, r] = await Promise.all([getFriends(), getRequests()]);
      setFriends(f.friends); setIncoming(r.incoming); setOutgoing(r.outgoing);
    } catch { /* NEEDS_HANDLE or not logged in — ignore */ }
  }

  useEffect(() => { if (user?.username) refreshAll(); }, [user?.username]);

  if (!user) return null;

  if (!user.username) {
    return (
      <div className="panel friends">
        <h3>Pick a handle to use friends</h3>
        <div className="add-song">
          <input placeholder="@handle (3–20)" value={handle} onChange={(e) => setHandle(e.target.value)} maxLength={20} />
          <button onClick={async () => {
            setError('');
            try { await setUsername(handle); } catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
          }}>Save</button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  async function add() {
    setError('');
    try { await sendRequest(addName.replace(/^@/, '')); setAddName(''); await refreshAll(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
  }

  return (
    <div className="panel friends">
      <h3>Friends <small>(you are @{user.username})</small></h3>
      <div className="add-song">
        <input placeholder="Add by @handle" value={addName} onChange={(e) => setAddName(e.target.value)} maxLength={21} />
        <button onClick={add}>Send request</button>
      </div>
      {error && <p className="error">{error}</p>}

      {incoming.length > 0 && (
        <>
          <h4>Requests</h4>
          <ul>{incoming.map((r) => (
            <li key={r.id}>
              @{r.username} ({r.displayName})
              <span>
                <button onClick={async () => { await acceptRequest(r.id); await refreshAll(); }}>Accept</button>
                <button onClick={async () => { await declineRequest(r.id); await refreshAll(); }}>Decline</button>
              </span>
            </li>
          ))}</ul>
        </>
      )}

      <h4>Your friends</h4>
      <ul>{friends.map((f) => {
        const p = presence.get(f.userId);
        return (
          <li key={f.userId}>
            <span className={p?.online ? 'dot on' : 'dot'} /> @{f.username}
            {p?.roomCode && <button onClick={() => onJoin(p.roomCode!)}>Join room</button>}
            <button onClick={async () => { await unfriend(f.userId); await refreshAll(); }}>✕</button>
          </li>
        );
      })}</ul>

      {outgoing.length > 0 && <p className="muted">Pending: {outgoing.map((o) => `@${o.username}`).join(', ')}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Write `client/src/friends/Toasts.tsx`**

```tsx
import { useEffect, useState } from 'react';
import socket from '../socket.js';

interface InviteToast { kind: 'invite'; id: number; text: string; code: string; }
interface RequestToast { kind: 'request'; id: number; text: string; }
type Toast = InviteToast | RequestToast;

let nextId = 1;

export default function Toasts({ onJoin }: { onJoin: (code: string) => void }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    function onInvite(p: { fromDisplayName: string; code: string; roomName: string | null }) {
      const id = nextId++;
      setToasts((t) => [...t, { kind: 'invite', id, code: p.code, text: `${p.fromDisplayName} invited you to ${p.roomName ?? 'a room'}` }]);
    }
    function onRequest(p: { fromUsername: string; fromDisplayName: string }) {
      const id = nextId++;
      setToasts((t) => [...t, { kind: 'request', id, text: `@${p.fromUsername} sent you a friend request` }]);
    }
    socket.on('invite:receive', onInvite);
    socket.on('friend:requestReceived', onRequest);
    return () => { socket.off('invite:receive', onInvite); socket.off('friend:requestReceived', onRequest); };
  }, []);

  function dismiss(id: number) { setToasts((t) => t.filter((x) => x.id !== id)); }

  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span>{t.text}</span>
          {t.kind === 'invite' && <button onClick={() => { onJoin(t.code); dismiss(t.id); }}>Join</button>}
          <button onClick={() => dismiss(t.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Render FriendsPanel + Toasts in `client/src/Landing.tsx`**

Add imports:

```tsx
import FriendsPanel from './friends/FriendsPanel.js';
import Toasts from './friends/Toasts.js';
```

In the returned JSX, add `<Toasts onJoin={joinByCode} />` right after the opening `<div className="landing">`, and `{user && <FriendsPanel onJoin={joinByCode} />}` just after the `{user && <AccountPanel .../>}` line. (`joinByCode` already exists from Phase 2a.)

- [ ] **Step 4: Add host invite control in `client/src/Room.tsx`**

Add imports:

```tsx
import { getFriends, type FriendSummary } from './friends/api.js';
import { usePresence } from './friends/usePresence.js';
```

Inside `Room`, after the playlists state, add:

```tsx
  const presence = usePresence();
  const [friends, setFriends] = useState<FriendSummary[]>([]);
  useEffect(() => {
    if (user?.username && isHost) getFriends().then((r) => setFriends(r.friends)).catch(() => {});
  }, [user?.username, isHost]);

  function inviteFriend(userId: string) {
    socket.emit('invite:send', { toUserId: userId });
  }

  const onlineFriends = friends.filter((f) => presence.get(f.userId)?.online);
```

Render an invite dropdown inside the host `controls` block (after the playlist select):

```tsx
              {user && onlineFriends.length > 0 && (
                <select
                  onChange={(e) => { if (e.target.value) inviteFriend(e.target.value); e.target.value = ''; }}
                  defaultValue=""
                >
                  <option value="" disabled>Invite a friend…</option>
                  {onlineFriends.map((f) => <option key={f.userId} value={f.userId}>@{f.username}</option>)}
                </select>
              )}
```

- [ ] **Step 5: Add styles to `client/src/styles.css`**

```css
.friends h4 { margin: 10px 0 4px; font-size: 13px; color: #9a9ac0; }
.friends li { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: #555; display: inline-block; }
.dot.on { background: #4ade80; }
.muted { color: #7a7aa0; font-size: 13px; }
.toasts { position: fixed; top: 16px; right: 16px; display: flex; flex-direction: column; gap: 8px; z-index: 50; }
.toast { background: #23234a; border: 1px solid #3a3a6a; border-radius: 10px; padding: 10px 12px; display: flex; gap: 10px; align-items: center; box-shadow: 0 4px 16px rgba(0,0,0,.4); }
```

- [ ] **Step 6: Typecheck and build**

Run: `npm run typecheck --workspace client && npm run build --workspace client`
Expected: clean typecheck, successful build.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add client friends panel, presence UI, toasts, and room invites"
```

---

### Task 8: End-to-end verification + docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update `README.md`**

Add a "Friends & presence (Phase 2b)" subsection under Accounts:

````markdown
### Friends & presence (Phase 2b)

Set an `@handle`, then add friends by handle (they accept your request). You'll
see which friends are online and what room they're in, with one-click **Join**.
Hosts can also invite an online friend directly — they get a notification with a
Join button.
````

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: shared, server (all suites incl. friendRepo, presenceRegistry, friend routes, presence sockets), and client suites PASS.

- [ ] **Step 3: Full manual E2E test**

1. Start server + client. Register two accounts in two different browsers (or a normal + private window): Alice and Bob.
2. As each, when prompted, set a handle (`alice`, `bob`).
3. As Alice, add `@bob`; as Bob, see the request notification, open the friends panel, and Accept.
4. As Bob, create a room. As Alice, confirm Bob shows online with a "Join room" button; click it and confirm you land in Bob's room in sync.
5. As Bob (host), invite `@alice` via the room's "Invite a friend" dropdown; if Alice is on the landing page, confirm she gets an invite toast with Join.
6. Unfriend from one side; confirm the other's friend list updates on refresh and presence stops showing.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Document Phase 2b friends and presence"
```

---

## Self-Review Notes

- **Spec coverage:** handles + gating (Tasks 1, 4), friendship model + REST (Tasks 2, 4), presence registry + fan-out (Tasks 3, 5), one-click join (Tasks 5–7 via roomCode + `joinByCode`), invites (Tasks 5, 7), realtime events (Task 5), client UI incl. handle prompt/friends/toasts/invite (Tasks 6–7), security/validation (zod in Task 4–5, server re-checks in Tasks 2/4/5), testing (unit + REST + socket across Tasks 1–5), docs (Task 8). All spec sections map to tasks.
- **Type consistency:** `PresenceInfo` defined once in `shared` and consumed by server + client; `AuthUser.username` added in Task 6 and used in Task 7; friend repo method names (`sendRequest`/`accept`/`decline`/`listFriends`/`listIncoming`/`listOutgoing`/`areFriends`/`unfriend`/`friendIds`) stable across Tasks 2, 4, 5; `user:<id>` socket-room addressing used consistently in Tasks 4–5.
- **Placeholder scan:** no TBD/TODO; every code step has full code.
- **Ordering note (called out for the implementer):** in Task 4 Step 5 and Task 5 Step 2, the `/api/account` + `/api/friends` mounts and the presence helper reference `io`, so they must be placed after `const io = new Server(...)` / `const rooms = new RoomManager();`. This is stated explicitly in those steps.
