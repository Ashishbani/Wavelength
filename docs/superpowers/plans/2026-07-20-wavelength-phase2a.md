# Wavelength Phase 2a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional email/password accounts to Wavelength, with saved (persistent) rooms, saved playlists, and per-user listening history, backed by SQLite — without changing the guest experience.

**Architecture:** A SQLite database (via better-sqlite3) sits behind a `db/` repository layer. Auth uses bcryptjs-hashed passwords and a JWT stored in an httpOnly cookie; Express REST routes handle account/room/playlist/history, and Socket.IO reads the same cookie on its handshake to identify the user. The in-memory `RoomManager` remains the runtime for live sessions; the DB is the source of truth for persistent definitions.

**Tech Stack:** TypeScript, Express, Socket.IO, better-sqlite3, bcryptjs, jsonwebtoken, cookie-parser, cors, zod, React + Vite, Vitest.

## Global Constraints

- **Language/module:** TypeScript, ESM (`"type": "module"`), `strict: true`, Node 20+.
- **Guests unaffected:** no cookie ⇒ behaves exactly like v1. All account features are additive.
- **Security (non-negotiable):** bcryptjs hashing (cost 12); `JWT_SECRET` from env (production refuses to start without it; dev fallback logs a warning); cookies httpOnly + sameSite=lax + secure-in-production; CORS locked to `CLIENT_ORIGIN` (default `http://localhost:5173`) with `credentials: true` (never wildcard with credentials); zod validation on every REST body and the `queue:loadPlaylist` payload; all SQL via prepared statements with bound parameters; ownership checks on every mutation; rate limiter on login/register.
- **Cookie name:** `wl_token`. JWT payload: `{ userId: string }`. Cookie maxAge 7 days.
- **IDs/timestamps:** UUID strings via `crypto.randomUUID()`; timestamps epoch ms integers.
- **DB file:** default path `wavelength.sqlite`; tests use `:memory:`. Must be gitignored.

---

### Task 1: Dependencies, DB open + migrations, userRepo

**Files:**
- Modify: `server/package.json` (add deps)
- Modify: `.gitignore` (add sqlite files)
- Create: `.env.example`
- Create: `server/src/db/db.ts`
- Create: `server/src/db/userRepo.ts`
- Test: `server/src/db/userRepo.test.ts`

**Interfaces:**
- Produces:
  - `db.ts`: `type DB = Database.Database`; `openDb(path?: string): DB`; `migrate(db: DB): void`.
  - `userRepo.ts`: `interface User { id: string; email: string; displayName: string; createdAt: number }`; `interface UserWithHash extends User { passwordHash: string }`; `createUserRepo(db: DB)` returning `{ create(email: string, passwordHash: string, displayName: string): User; findByEmail(email: string): UserWithHash | null; findById(id: string): User | null }`. `create` throws `Error('EMAIL_TAKEN')` on unique violation.

- [ ] **Step 1: Add server dependencies to `server/package.json`**

Add to `dependencies`: `"better-sqlite3": "^11.0.0"`, `"bcryptjs": "^2.4.3"`, `"jsonwebtoken": "^9.0.2"`, `"cookie-parser": "^1.4.6"`, `"cors": "^2.8.5"`, `"zod": "^3.23.0"`.
Add to `devDependencies`: `"@types/better-sqlite3": "^7.6.0"`, `"@types/bcryptjs": "^2.4.6"`, `"@types/jsonwebtoken": "^9.0.0"`, `"@types/cookie-parser": "^1.4.7"`, `"@types/cors": "^2.8.17"`.
Then run `npm install` (better-sqlite3 is native; prebuilt binaries are used on Node 20).

- [ ] **Step 2: Add sqlite files to `.gitignore`**

Append:
```
*.sqlite
*.sqlite-journal
*.sqlite-wal
*.sqlite-shm
```

- [ ] **Step 3: Create `.env.example`**

```
# Server
PORT=3001
CLIENT_ORIGIN=http://localhost:5173
JWT_SECRET=change-me-in-production
DB_PATH=wavelength.sqlite
```

- [ ] **Step 4: Write the failing test `server/src/db/userRepo.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrate, type DB } from './db.js';
import { createUserRepo } from './userRepo.js';

describe('userRepo', () => {
  let db: DB;
  let repo: ReturnType<typeof createUserRepo>;
  beforeEach(() => {
    db = openDb(':memory:');
    migrate(db);
    repo = createUserRepo(db);
  });

  it('creates and finds a user by email', () => {
    const u = repo.create('a@b.com', 'hash1', 'Alice');
    expect(u.id).toBeTruthy();
    expect(u.email).toBe('a@b.com');
    const found = repo.findByEmail('a@b.com');
    expect(found?.passwordHash).toBe('hash1');
    expect(found?.displayName).toBe('Alice');
  });

  it('finds a user by id without exposing the hash', () => {
    const u = repo.create('a@b.com', 'hash1', 'Alice');
    const byId = repo.findById(u.id);
    expect(byId?.email).toBe('a@b.com');
    expect((byId as Record<string, unknown>).passwordHash).toBeUndefined();
  });

  it('returns null for unknown lookups', () => {
    expect(repo.findByEmail('nope@x.com')).toBeNull();
    expect(repo.findById('nope')).toBeNull();
  });

  it('rejects a duplicate email', () => {
    repo.create('a@b.com', 'h', 'Alice');
    expect(() => repo.create('a@b.com', 'h2', 'Bob')).toThrow('EMAIL_TAKEN');
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm run test --workspace server`
Expected: FAIL — cannot find `./db.js`.

- [ ] **Step 6: Write `server/src/db/db.ts`**

```ts
import Database from 'better-sqlite3';

export type DB = Database.Database;

export function openDb(path = process.env.DB_PATH ?? 'wavelength.sqlite'): DB {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function migrate(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS saved_rooms (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (owner_user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (owner_user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS playlist_items (
      id TEXT PRIMARY KEY,
      playlist_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      title TEXT NOT NULL,
      position INTEGER NOT NULL,
      FOREIGN KEY (playlist_id) REFERENCES playlists(id)
    );
    CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      title TEXT NOT NULL,
      played_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
}
```

- [ ] **Step 7: Write `server/src/db/userRepo.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';

export interface User {
  id: string;
  email: string;
  displayName: string;
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
  created_at: number;
}

export function createUserRepo(db: DB) {
  const insert = db.prepare(
    'INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const byEmail = db.prepare('SELECT * FROM users WHERE email = ?');
  const byId = db.prepare('SELECT * FROM users WHERE id = ?');

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
      return { id, email, displayName, createdAt };
    },
    findByEmail(email: string): UserWithHash | null {
      const row = byEmail.get(email) as UserRow | undefined;
      if (!row) return null;
      return { id: row.id, email: row.email, displayName: row.display_name, createdAt: row.created_at, passwordHash: row.password_hash };
    },
    findById(id: string): User | null {
      const row = byId.get(id) as UserRow | undefined;
      if (!row) return null;
      return { id: row.id, email: row.email, displayName: row.display_name, createdAt: row.created_at };
    },
  };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm run test --workspace server`
Expected: userRepo tests PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Add SQLite db layer, migrations, and userRepo"
```

---

### Task 2: Auth utilities (password, token, validators, rate limiter)

**Files:**
- Create: `server/src/auth/password.ts`
- Create: `server/src/auth/token.ts`
- Create: `server/src/auth/validators.ts`
- Create: `server/src/auth/rateLimit.ts`
- Test: `server/src/auth/password.test.ts`
- Test: `server/src/auth/token.test.ts`
- Test: `server/src/auth/rateLimit.test.ts`

**Interfaces:**
- Produces:
  - `password.ts`: `hashPassword(pw: string): Promise<string>`; `verifyPassword(pw: string, hash: string): Promise<boolean>`.
  - `token.ts`: `interface TokenPayload { userId: string }`; `getSecret(): string`; `signToken(p: TokenPayload): string`; `verifyToken(token: string): TokenPayload | null`.
  - `validators.ts`: zod schemas `registerSchema`, `loginSchema`, `createRoomSchema`, `createPlaylistSchema`, `loadPlaylistSchema`.
  - `rateLimit.ts`: `createRateLimiter(opts: { windowMs: number; max: number }): { check(key: string): boolean }` — `check` returns true if allowed, false if over the limit.

- [ ] **Step 1: Write `server/src/auth/password.ts`**

```ts
import bcrypt from 'bcryptjs';

const COST = 12;

export function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, COST);
}

export function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}
```

- [ ] **Step 2: Write `server/src/auth/token.ts`**

```ts
import jwt from 'jsonwebtoken';

export interface TokenPayload {
  userId: string;
}

export function getSecret(): string {
  const s = process.env.JWT_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }
  console.warn('[wavelength] JWT_SECRET not set — using an insecure dev secret.');
  return 'dev-insecure-secret';
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: '7d' });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, getSecret());
    if (typeof decoded === 'object' && decoded && 'userId' in decoded) {
      return { userId: String((decoded as { userId: unknown }).userId) };
    }
    return null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Write `server/src/auth/validators.ts`**

```ts
import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  displayName: z.string().trim().min(1).max(40),
});

export const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

export const createRoomSchema = z.object({
  name: z.string().trim().min(1).max(60),
});

export const createPlaylistSchema = z.object({
  name: z.string().trim().min(1).max(60),
  items: z
    .array(z.object({ videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/), title: z.string().max(200) }))
    .max(500),
});

export const loadPlaylistSchema = z.object({
  playlistId: z.string().min(1).max(64),
});
```

- [ ] **Step 4: Write `server/src/auth/rateLimit.ts`**

```ts
interface Bucket {
  count: number;
  resetAt: number;
}

export function createRateLimiter(opts: { windowMs: number; max: number }) {
  const buckets = new Map<string, Bucket>();
  return {
    check(key: string): boolean {
      const now = Date.now();
      const b = buckets.get(key);
      if (!b || now > b.resetAt) {
        buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
        return true;
      }
      if (b.count >= opts.max) return false;
      b.count += 1;
      return true;
    },
  };
}
```

- [ ] **Step 5: Write `server/src/auth/password.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password', () => {
  it('hashes and verifies a correct password', async () => {
    const hash = await hashPassword('hunter2secret');
    expect(hash).not.toBe('hunter2secret');
    expect(await verifyPassword('hunter2secret', hash)).toBe(true);
  });
  it('rejects a wrong password', async () => {
    const hash = await hashPassword('hunter2secret');
    expect(await verifyPassword('wrongpass', hash)).toBe(false);
  });
});
```

- [ ] **Step 6: Write `server/src/auth/token.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { signToken, verifyToken } from './token.js';

describe('token', () => {
  it('signs and verifies a payload', () => {
    const t = signToken({ userId: 'u1' });
    expect(verifyToken(t)?.userId).toBe('u1');
  });
  it('returns null for a tampered token', () => {
    const t = signToken({ userId: 'u1' });
    expect(verifyToken(t + 'x')).toBeNull();
  });
  it('returns null for garbage', () => {
    expect(verifyToken('not-a-token')).toBeNull();
  });
});
```

- [ ] **Step 7: Write `server/src/auth/rateLimit.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createRateLimiter } from './rateLimit.js';

describe('rateLimit', () => {
  it('allows up to max then blocks', () => {
    const rl = createRateLimiter({ windowMs: 60_000, max: 3 });
    expect(rl.check('ip1')).toBe(true);
    expect(rl.check('ip1')).toBe(true);
    expect(rl.check('ip1')).toBe(true);
    expect(rl.check('ip1')).toBe(false);
  });
  it('tracks keys independently', () => {
    const rl = createRateLimiter({ windowMs: 60_000, max: 1 });
    expect(rl.check('ip1')).toBe(true);
    expect(rl.check('ip2')).toBe(true);
    expect(rl.check('ip1')).toBe(false);
  });
});
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm run test --workspace server`
Expected: password, token, rateLimit tests PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Add auth utilities: password hashing, JWT, validators, rate limiter"
```

---

### Task 3: Auth REST routes + cookie/CORS wiring + integration test

**Files:**
- Create: `server/src/auth/routes.ts`
- Modify: `server/src/index.ts` (mount express json/cookie-parser/cors, build db + repos, mount auth router)
- Test: `server/src/auth/routes.test.ts`

**Interfaces:**
- Consumes: `createUserRepo`, `hashPassword`/`verifyPassword`, `signToken`/`verifyToken`, `registerSchema`/`loginSchema`, `createRateLimiter`.
- Produces:
  - `routes.ts`: `createAuthRouter(userRepo: ReturnType<typeof createUserRepo>): Router`. Cookie constant `COOKIE_NAME = 'wl_token'` and helper `cookieOptions()` exported for reuse.
  - `index.ts`: `createServer(port?: number, injectedDb?: DB)` — now opens/migrates a DB (or uses `injectedDb`), builds repos, and returns `{ io, httpServer, close }` (unchanged shape). Also exports the built `db` on the return object as `{ io, httpServer, db, close }` for tests.

- [ ] **Step 1: Write the failing test `server/src/auth/routes.test.ts`**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { openDb, migrate } from '../db/db.js';
import { createServer } from '../index.js';

describe('auth routes', () => {
  let server: ReturnType<typeof createServer>;
  afterEach(async () => { await server.close(); });

  function start() {
    const db = openDb(':memory:');
    migrate(db);
    server = createServer(0, db);
    const port = (server.httpServer.address() as { port: number }).port;
    return `http://localhost:${port}`;
  }

  it('registers, identifies via cookie, then logs out', async () => {
    const base = start();
    const reg = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', password: 'password1', displayName: 'Alice' }),
    });
    expect(reg.status).toBe(200);
    const cookie = reg.headers.get('set-cookie')!;
    expect(cookie).toContain('wl_token');
    const body = await reg.json();
    expect(body.displayName).toBe('Alice');

    const me = await fetch(`${base}/api/auth/me`, { headers: { cookie } });
    const meBody = await me.json();
    expect(meBody.user.email).toBe('a@b.com');

    const out = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { cookie } });
    expect(out.status).toBe(200);
  });

  it('rejects duplicate email', async () => {
    const base = start();
    const payload = { email: 'a@b.com', password: 'password1', displayName: 'Alice' };
    await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const dup = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    expect(dup.status).toBe(409);
  });

  it('rejects invalid body with 400', async () => {
    const base = start();
    const bad = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x', password: '1', displayName: '' }) });
    expect(bad.status).toBe(400);
  });

  it('logs in with correct password and rejects wrong one generically', async () => {
    const base = start();
    await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@b.com', password: 'password1', displayName: 'Alice' }) });
    const good = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@b.com', password: 'password1' }) });
    expect(good.status).toBe(200);
    const bad = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@b.com', password: 'nope' }) });
    expect(bad.status).toBe(401);
    expect((await bad.json()).error).toBe('Invalid email or password');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace server`
Expected: FAIL — `createServer` does not accept a db / `/api/auth` not mounted.

- [ ] **Step 3: Write `server/src/auth/routes.ts`**

```ts
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
    secure: process.env.NODE_ENV === 'production',
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
      const user = userRepo.create(email.toLowerCase(), hash, displayName);
      res.cookie(COOKIE_NAME, signToken({ userId: user.id }), cookieOptions());
      res.json({ id: user.id, email: user.email, displayName: user.displayName });
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
    const user = userRepo.findByEmail(email.toLowerCase());
    const ok = user ? await verifyPassword(password, user.passwordHash) : false;
    if (!user || !ok) return res.status(401).json({ error: 'Invalid email or password' });
    res.cookie(COOKIE_NAME, signToken({ userId: user.id }), cookieOptions());
    res.json({ id: user.id, email: user.email, displayName: user.displayName });
  });

  router.post('/logout', (_req, res) => {
    res.clearCookie(COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    // req.userId is populated by the auth middleware in index.ts
    const userId = (req as Request & { userId?: string }).userId;
    if (!userId) return res.json({ user: null });
    const user = userRepo.findById(userId);
    res.json({ user: user ? { id: user.id, email: user.email, displayName: user.displayName } : null });
  });

  return router;
}
```

- [ ] **Step 4: Rewrite `server/src/index.ts` to wire db, cookies, cors, and auth middleware**

```ts
import { createServer as createHttpServer } from 'node:http';
import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  CreateJoinResult,
} from '@wavelength/shared';
import { isValidVideoId } from '@wavelength/shared';
import { RoomManager } from './roomManager.js';
import { openDb, migrate, type DB } from './db/db.js';
import { createUserRepo } from './db/userRepo.js';
import { createAuthRouter, COOKIE_NAME } from './auth/routes.js';
import { verifyToken } from './auth/token.js';

const MAX_CHAT_LEN = 500;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';

export function createServer(port = 3001, injectedDb?: DB) {
  const db = injectedDb ?? (() => { const d = openDb(); migrate(d); return d; })();
  const userRepo = createUserRepo(db);

  const app = express();
  app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  // Populate req.userId from the auth cookie (null if absent/invalid).
  app.use((req: Request & { userId?: string }, _res: Response, next: NextFunction) => {
    const token = (req.cookies as Record<string, string> | undefined)?.[COOKIE_NAME];
    req.userId = token ? verifyToken(token)?.userId : undefined;
    next();
  });

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', createAuthRouter(userRepo));

  const httpServer = createHttpServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: CLIENT_ORIGIN, credentials: true },
  });
  const rooms = new RoomManager();

  // Identify the socket's user from the same cookie.
  io.use((socket, next) => {
    const raw = socket.handshake.headers.cookie ?? '';
    const match = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE_NAME}=`));
    const token = match ? decodeURIComponent(match.slice(COOKIE_NAME.length + 1)) : '';
    (socket.data as { userId?: string }).userId = token ? verifyToken(token)?.userId : undefined;
    next();
  });

  function nameOf(socketId: string, code: string): string {
    const room = rooms.getRoom(code);
    return room?.members.find((m) => m.id === socketId)?.name ?? 'someone';
  }

  io.on('connection', (socket) => {
    socket.on('time:ping', ({ t0 }, cb) => cb({ t0, serverTime: Date.now() }));

    socket.on('room:create', ({ name }, cb: (r: CreateJoinResult) => void) => {
      const clean = (name ?? '').trim().slice(0, 40);
      if (!clean) return cb({ ok: false, error: 'Please enter a name.' });
      const state = rooms.createRoom(socket.id, clean);
      socket.join(state.code);
      cb({ ok: true, state, selfId: socket.id });
    });

    socket.on('room:join', ({ code, name }, cb: (r: CreateJoinResult) => void) => {
      const clean = (name ?? '').trim().slice(0, 40);
      const upper = (code ?? '').trim().toUpperCase();
      if (!clean) return cb({ ok: false, error: 'Please enter a name.' });
      try {
        const state = rooms.joinRoom(upper, socket.id, clean);
        socket.join(upper);
        cb({ ok: true, state, selfId: socket.id });
        io.to(upper).emit('room:state', state);
      } catch (e) {
        const msg = (e as Error).message;
        cb({ ok: false, error: msg === 'NAME_TAKEN' ? 'That name is taken in this room.' : 'Room not found.' });
      }
    });

    function hostAction(fn: (code: string) => void) {
      const room = rooms.getRoomByMember(socket.id);
      if (!room || !rooms.isHost(room.code, socket.id)) return;
      fn(room.code);
    }

    socket.on('playback:play', ({ positionSec }) =>
      hostAction((code) => io.to(code).emit('playback:update', rooms.setPlayback(code, { isPlaying: true, positionSec }, Date.now()))),
    );
    socket.on('playback:pause', ({ positionSec }) =>
      hostAction((code) => io.to(code).emit('playback:update', rooms.setPlayback(code, { isPlaying: false, positionSec }, Date.now()))),
    );
    socket.on('playback:seek', ({ positionSec }) =>
      hostAction((code) => io.to(code).emit('playback:update', rooms.setPlayback(code, { positionSec }, Date.now()))),
    );
    socket.on('playback:heartbeat', ({ positionSec }) =>
      hostAction((code) => io.to(code).emit('playback:update', rooms.setPlayback(code, { positionSec }, Date.now()))),
    );

    socket.on('queue:next', () =>
      hostAction((code) => {
        const pb = rooms.advanceQueue(code, Date.now());
        io.to(code).emit('playback:update', pb);
        const room = rooms.getRoom(code);
        if (room) io.to(code).emit('room:state', room);
      }),
    );

    socket.on('queue:add', ({ videoId, title }) => {
      const room = rooms.getRoomByMember(socket.id);
      if (!room) return;
      if (!isValidVideoId(videoId)) return;
      const cleanTitle = (title ?? '').toString().trim().slice(0, 200) || videoId;
      const updated = rooms.addToQueue(room.code, { videoId, title: cleanTitle, addedBy: nameOf(socket.id, room.code) });
      io.to(room.code).emit('room:state', updated);
      if (!updated.playback.videoId) {
        const pb = rooms.advanceQueue(room.code, Date.now());
        io.to(room.code).emit('playback:update', pb);
        const after = rooms.getRoom(room.code);
        if (after) io.to(room.code).emit('room:state', after);
      }
    });

    socket.on('chat:send', ({ text }) => {
      const room = rooms.getRoomByMember(socket.id);
      if (!room) return;
      const clean = (text ?? '').toString().trim().slice(0, MAX_CHAT_LEN);
      if (!clean) return;
      io.to(room.code).emit('chat:message', { name: nameOf(socket.id, room.code), text: clean, ts: Date.now() });
    });

    socket.on('disconnect', () => {
      const res = rooms.leaveRoom(socket.id);
      if (res?.state) io.to(res.code).emit('room:state', res.state);
    });
  });

  httpServer.listen(port);
  return {
    io,
    httpServer,
    db,
    rooms,
    close: () =>
      new Promise<void>((resolve) => {
        io.close();
        httpServer.close(() => resolve());
      }),
  };
}

if (process.argv[1] && process.argv[1].endsWith('index.ts')) {
  const port = Number(process.env.PORT ?? 3001);
  createServer(port);
  console.log(`Wavelength server listening on :${port}`);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace server`
Expected: auth routes tests PASS; existing socket + roomManager tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add auth REST routes with cookie sessions and CORS credentials"
```

---

### Task 4: Socket user identity test (guard the handshake wiring)

**Files:**
- Test: `server/src/socketAuth.test.ts`

**Interfaces:**
- Consumes: `createServer`, `signToken`, `COOKIE_NAME`.
- Produces: nothing new; this task pins the behavior that `socket.data.userId` is set from the cookie. To make it observable, add a debug-only event.

- [ ] **Step 1: Add an observable `whoami` event to `server/src/index.ts`**

Inside `io.on('connection', (socket) => { ... })`, add near `time:ping`:

```ts
    socket.on('whoami', (cb: (res: { userId: string | null }) => void) =>
      cb({ userId: (socket.data as { userId?: string }).userId ?? null }),
    );
```

And extend the shared `ClientToServerEvents` in `shared/src/events.ts`:

```ts
  'whoami': (cb: (res: { userId: string | null }) => void) => void;
```

- [ ] **Step 2: Write `server/src/socketAuth.test.ts`**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import { openDb, migrate } from './db/db.js';
import { createServer } from './index.js';
import { signToken } from './auth/token.js';
import { COOKIE_NAME } from './auth/routes.js';

describe('socket auth', () => {
  let server: ReturnType<typeof createServer>;
  const sockets: Socket[] = [];
  afterEach(async () => { sockets.forEach((s) => s.close()); sockets.length = 0; await server.close(); });

  function start() {
    const db = openDb(':memory:');
    migrate(db);
    server = createServer(0, db);
    return (server.httpServer.address() as { port: number }).port;
  }

  function connect(port: number, cookie?: string): Promise<Socket> {
    return new Promise((resolve) => {
      const s = ioc(`http://localhost:${port}`, {
        transports: ['websocket'],
        extraHeaders: cookie ? { cookie } : undefined,
      });
      s.on('connect', () => resolve(s));
    });
  }

  it('sets userId for an authed socket and null for a guest', async () => {
    const port = start();
    const token = signToken({ userId: 'user-123' });

    const authed = await connect(port, `${COOKIE_NAME}=${token}`);
    sockets.push(authed);
    const a = await new Promise<{ userId: string | null }>((r) => authed.emit('whoami', r));
    expect(a.userId).toBe('user-123');

    const guest = await connect(port);
    sockets.push(guest);
    const g = await new Promise<{ userId: string | null }>((r) => guest.emit('whoami', r));
    expect(g.userId).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm run test --workspace server`
Expected: socket auth test PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Verify socket identifies user from auth cookie"
```

---

### Task 5: Saved rooms — roomRepo, REST routes, RoomManager.createRoomWithCode, reactivation

**Files:**
- Create: `server/src/db/roomRepo.ts`
- Create: `server/src/api/roomRoutes.ts`
- Modify: `server/src/roomManager.ts` (add `createRoomWithCode`)
- Modify: `server/src/index.ts` (mount room routes; reactivate saved room on join)
- Test: `server/src/db/roomRepo.test.ts`
- Test: `server/src/api/roomRoutes.test.ts`
- Test: `server/src/roomManager.test.ts` (add createRoomWithCode cases)

**Interfaces:**
- Produces:
  - `roomRepo.ts`: `interface SavedRoom { id: string; ownerUserId: string; code: string; name: string; createdAt: number }`; `createRoomRepo(db)` returning `{ create(ownerUserId, code, name): SavedRoom; listByOwner(ownerUserId): SavedRoom[]; findByCode(code): SavedRoom | null; deleteByCode(code, ownerUserId): boolean }`. `deleteByCode` returns true if a row owned by the user was deleted.
  - `roomManager.ts`: `createRoomWithCode(code: string, hostId: string, hostName: string): RoomState` (throws `'CODE_IN_USE'` if a live room already has that code).
  - `roomRoutes.ts`: `createRoomRouter(roomRepo, genCode): Router` where `genCode(): string`.

- [ ] **Step 1: Add `createRoomWithCode` test cases to `server/src/roomManager.test.ts`**

Append inside the `describe('RoomManager', ...)` block:

```ts
  it('creates a live room with a specific code', () => {
    const state = mgr.createRoomWithCode('ABC123', 'h1', 'Alice');
    expect(state.code).toBe('ABC123');
    expect(state.hostId).toBe('h1');
    expect(mgr.getRoom('ABC123')?.members).toHaveLength(1);
  });

  it('throws if the code is already live', () => {
    mgr.createRoomWithCode('ABC123', 'h1', 'Alice');
    expect(() => mgr.createRoomWithCode('ABC123', 'h2', 'Bob')).toThrow('CODE_IN_USE');
  });
```

- [ ] **Step 2: Add `createRoomWithCode` to `server/src/roomManager.ts`**

Add this method inside the `RoomManager` class (e.g. after `createRoom`):

```ts
  createRoomWithCode(code: string, hostId: string, hostName: string): RoomState {
    if (this.rooms.has(code)) throw new Error('CODE_IN_USE');
    const state: RoomState = {
      code,
      hostId,
      members: [{ id: hostId, name: hostName }],
      queue: [],
      playback: { videoId: null, isPlaying: false, positionSec: 0, lastUpdateServerTs: 0 },
    };
    this.rooms.set(code, state);
    return state;
  }
```

- [ ] **Step 3: Write `server/src/db/roomRepo.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';

export interface SavedRoom {
  id: string;
  ownerUserId: string;
  code: string;
  name: string;
  createdAt: number;
}

interface RoomRow {
  id: string;
  owner_user_id: string;
  code: string;
  name: string;
  created_at: number;
}

function toRoom(row: RoomRow): SavedRoom {
  return { id: row.id, ownerUserId: row.owner_user_id, code: row.code, name: row.name, createdAt: row.created_at };
}

export function createRoomRepo(db: DB) {
  const insert = db.prepare('INSERT INTO saved_rooms (id, owner_user_id, code, name, created_at) VALUES (?, ?, ?, ?, ?)');
  const byOwner = db.prepare('SELECT * FROM saved_rooms WHERE owner_user_id = ? ORDER BY created_at DESC');
  const byCode = db.prepare('SELECT * FROM saved_rooms WHERE code = ?');
  const del = db.prepare('DELETE FROM saved_rooms WHERE code = ? AND owner_user_id = ?');

  return {
    create(ownerUserId: string, code: string, name: string): SavedRoom {
      const id = randomUUID();
      const createdAt = Date.now();
      insert.run(id, ownerUserId, code, name, createdAt);
      return { id, ownerUserId, code, name, createdAt };
    },
    listByOwner(ownerUserId: string): SavedRoom[] {
      return (byOwner.all(ownerUserId) as RoomRow[]).map(toRoom);
    },
    findByCode(code: string): SavedRoom | null {
      const row = byCode.get(code) as RoomRow | undefined;
      return row ? toRoom(row) : null;
    },
    deleteByCode(code: string, ownerUserId: string): boolean {
      return del.run(code, ownerUserId).changes > 0;
    },
  };
}
```

- [ ] **Step 4: Write `server/src/api/roomRoutes.ts`**

```ts
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
```

- [ ] **Step 5: Wire room routes + reactivation into `server/src/index.ts`**

Add imports:

```ts
import { randomUUID } from 'node:crypto';
import { createRoomRepo } from './db/roomRepo.js';
import { createRoomRouter } from './api/roomRoutes.js';
```

After `const userRepo = createUserRepo(db);` add:

```ts
  const roomRepo = createRoomRepo(db);
  const genCode = () => randomUUID().slice(0, 6).toUpperCase();
```

After `app.use('/api/auth', createAuthRouter(userRepo));` add:

```ts
  app.use('/api/rooms', createRoomRouter(roomRepo, genCode));
```

Replace the `room:join` handler body so it reactivates a saved room when there is no live instance but a saved definition exists:

```ts
    socket.on('room:join', ({ code, name }, cb: (r: CreateJoinResult) => void) => {
      const clean = (name ?? '').trim().slice(0, 40);
      const upper = (code ?? '').trim().toUpperCase();
      if (!clean) return cb({ ok: false, error: 'Please enter a name.' });
      try {
        let state;
        if (!rooms.getRoom(upper) && roomRepo.findByCode(upper)) {
          state = rooms.createRoomWithCode(upper, socket.id, clean);
        } else {
          state = rooms.joinRoom(upper, socket.id, clean);
        }
        socket.join(upper);
        cb({ ok: true, state, selfId: socket.id });
        io.to(upper).emit('room:state', state);
      } catch (e) {
        const msg = (e as Error).message;
        cb({ ok: false, error: msg === 'NAME_TAKEN' ? 'That name is taken in this room.' : 'Room not found.' });
      }
    });
```

- [ ] **Step 6: Write `server/src/db/roomRepo.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrate, type DB } from './db.js';
import { createUserRepo } from './userRepo.js';
import { createRoomRepo } from './roomRepo.js';

describe('roomRepo', () => {
  let db: DB;
  let rooms: ReturnType<typeof createRoomRepo>;
  let ownerId: string;
  beforeEach(() => {
    db = openDb(':memory:');
    migrate(db);
    ownerId = createUserRepo(db).create('a@b.com', 'h', 'Alice').id;
    rooms = createRoomRepo(db);
  });

  it('creates, lists, and finds a saved room', () => {
    rooms.create(ownerId, 'ABC123', 'Friday Jams');
    expect(rooms.findByCode('ABC123')?.name).toBe('Friday Jams');
    expect(rooms.listByOwner(ownerId)).toHaveLength(1);
  });

  it('only deletes a room owned by the requester', () => {
    rooms.create(ownerId, 'ABC123', 'Friday Jams');
    expect(rooms.deleteByCode('ABC123', 'someone-else')).toBe(false);
    expect(rooms.deleteByCode('ABC123', ownerId)).toBe(true);
    expect(rooms.findByCode('ABC123')).toBeNull();
  });
});
```

- [ ] **Step 7: Write `server/src/api/roomRoutes.test.ts`**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { openDb, migrate } from '../db/db.js';
import { createServer } from '../index.js';

async function registerAndCookie(base: string): Promise<string> {
  const reg = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.com', password: 'password1', displayName: 'Alice' }),
  });
  return reg.headers.get('set-cookie')!;
}

describe('room routes', () => {
  let server: ReturnType<typeof createServer>;
  afterEach(async () => { await server.close(); });
  function start() {
    const db = openDb(':memory:'); migrate(db);
    server = createServer(0, db);
    return `http://localhost:${(server.httpServer.address() as { port: number }).port}`;
  }

  it('requires auth to create a saved room', async () => {
    const base = start();
    const res = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'X' }) });
    expect(res.status).toBe(401);
  });

  it('creates and lists a saved room for the owner', async () => {
    const base = start();
    const cookie = await registerAndCookie(base);
    const create = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'Friday Jams' }) });
    expect(create.status).toBe(200);
    const { code } = await create.json();
    expect(code).toHaveLength(6);
    const list = await fetch(`${base}/api/rooms`, { headers: { cookie } });
    const { rooms } = await list.json();
    expect(rooms).toEqual([{ code, name: 'Friday Jams' }]);
  });
});
```

- [ ] **Step 8: Run tests**

Run: `npm run test --workspace server`
Expected: roomManager (incl. new cases), roomRepo, and room routes tests PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Add saved rooms: roomRepo, REST routes, and live reactivation on join"
```

---

### Task 6: Playlists — playlistRepo, REST routes, queue:loadPlaylist

**Files:**
- Create: `server/src/db/playlistRepo.ts`
- Create: `server/src/api/playlistRoutes.ts`
- Modify: `server/src/index.ts` (mount playlist routes; add `queue:loadPlaylist` handler)
- Modify: `shared/src/events.ts` (add `queue:loadPlaylist`)
- Test: `server/src/db/playlistRepo.test.ts`
- Test: `server/src/api/playlistRoutes.test.ts`

**Interfaces:**
- Produces:
  - `playlistRepo.ts`: `interface PlaylistItem { videoId: string; title: string }`; `interface Playlist { id: string; ownerUserId: string; name: string; createdAt: number; items: PlaylistItem[] }`; `createPlaylistRepo(db)` returning `{ create(ownerUserId, name, items): Playlist; listByOwner(ownerUserId): Playlist[]; findById(id): Playlist | null; deleteById(id, ownerUserId): boolean }`.
  - `events.ts`: add to `ClientToServerEvents`: `'queue:loadPlaylist': (payload: { playlistId: string }) => void;`.

- [ ] **Step 1: Add `queue:loadPlaylist` to `shared/src/events.ts`**

Add inside `ClientToServerEvents`:

```ts
  'queue:loadPlaylist': (payload: { playlistId: string }) => void;
```

- [ ] **Step 2: Write `server/src/db/playlistRepo.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';

export interface PlaylistItem {
  videoId: string;
  title: string;
}

export interface Playlist {
  id: string;
  ownerUserId: string;
  name: string;
  createdAt: number;
  items: PlaylistItem[];
}

interface PlaylistRow { id: string; owner_user_id: string; name: string; created_at: number; }
interface ItemRow { video_id: string; title: string; }

export function createPlaylistRepo(db: DB) {
  const insertPlaylist = db.prepare('INSERT INTO playlists (id, owner_user_id, name, created_at) VALUES (?, ?, ?, ?)');
  const insertItem = db.prepare('INSERT INTO playlist_items (id, playlist_id, video_id, title, position) VALUES (?, ?, ?, ?, ?)');
  const byOwner = db.prepare('SELECT * FROM playlists WHERE owner_user_id = ? ORDER BY created_at DESC');
  const byId = db.prepare('SELECT * FROM playlists WHERE id = ?');
  const itemsFor = db.prepare('SELECT video_id, title FROM playlist_items WHERE playlist_id = ? ORDER BY position ASC');
  const delItems = db.prepare('DELETE FROM playlist_items WHERE playlist_id = ?');
  const delPlaylist = db.prepare('DELETE FROM playlists WHERE id = ? AND owner_user_id = ?');

  function loadItems(playlistId: string): PlaylistItem[] {
    return (itemsFor.all(playlistId) as ItemRow[]).map((r) => ({ videoId: r.video_id, title: r.title }));
  }
  function hydrate(row: PlaylistRow): Playlist {
    return { id: row.id, ownerUserId: row.owner_user_id, name: row.name, createdAt: row.created_at, items: loadItems(row.id) };
  }

  const createTx = db.transaction((ownerUserId: string, name: string, items: PlaylistItem[]): Playlist => {
    const id = randomUUID();
    const createdAt = Date.now();
    insertPlaylist.run(id, ownerUserId, name, createdAt);
    items.forEach((it, i) => insertItem.run(randomUUID(), id, it.videoId, it.title, i));
    return { id, ownerUserId, name, createdAt, items };
  });

  const deleteTx = db.transaction((id: string, ownerUserId: string): boolean => {
    const owned = byId.get(id) as PlaylistRow | undefined;
    if (!owned || owned.owner_user_id !== ownerUserId) return false;
    delItems.run(id);
    return delPlaylist.run(id, ownerUserId).changes > 0;
  });

  return {
    create(ownerUserId: string, name: string, items: PlaylistItem[]): Playlist {
      return createTx(ownerUserId, name, items);
    },
    listByOwner(ownerUserId: string): Playlist[] {
      return (byOwner.all(ownerUserId) as PlaylistRow[]).map(hydrate);
    },
    findById(id: string): Playlist | null {
      const row = byId.get(id) as PlaylistRow | undefined;
      return row ? hydrate(row) : null;
    },
    deleteById(id: string, ownerUserId: string): boolean {
      return deleteTx(id, ownerUserId);
    },
  };
}
```

- [ ] **Step 3: Write `server/src/api/playlistRoutes.ts`**

```ts
import { Router, type Request } from 'express';
import type { createPlaylistRepo } from '../db/playlistRepo.js';
import { createPlaylistSchema } from '../auth/validators.js';

function requireAuth(req: Request): string | null {
  return (req as Request & { userId?: string }).userId ?? null;
}

export function createPlaylistRouter(playlistRepo: ReturnType<typeof createPlaylistRepo>): Router {
  const router = Router();

  router.post('/', (req, res) => {
    const userId = requireAuth(req);
    if (!userId) return res.status(401).json({ error: 'Log in to save playlists.' });
    const parsed = createPlaylistSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid playlist.' });
    const pl = playlistRepo.create(userId, parsed.data.name, parsed.data.items);
    res.json({ id: pl.id, name: pl.name, items: pl.items });
  });

  router.get('/', (req, res) => {
    const userId = requireAuth(req);
    if (!userId) return res.status(401).json({ error: 'Log in to view playlists.' });
    res.json({ playlists: playlistRepo.listByOwner(userId).map((p) => ({ id: p.id, name: p.name, items: p.items })) });
  });

  router.delete('/:id', (req, res) => {
    const userId = requireAuth(req);
    if (!userId) return res.status(401).json({ error: 'Log in to delete playlists.' });
    const ok = playlistRepo.deleteById(req.params.id, userId);
    if (!ok) return res.status(404).json({ error: 'Playlist not found.' });
    res.json({ ok: true });
  });

  return router;
}
```

- [ ] **Step 4: Wire playlist routes + `queue:loadPlaylist` into `server/src/index.ts`**

Add imports:

```ts
import { createPlaylistRepo } from './db/playlistRepo.js';
import { createPlaylistRouter } from './api/playlistRoutes.js';
import { loadPlaylistSchema } from './auth/validators.js';
```

After `const roomRepo = createRoomRepo(db);` add:

```ts
  const playlistRepo = createPlaylistRepo(db);
```

After the `/api/rooms` mount add:

```ts
  app.use('/api/playlists', createPlaylistRouter(playlistRepo));
```

Inside `io.on('connection', ...)`, add a handler (host-only, owner-only):

```ts
    socket.on('queue:loadPlaylist', (payload) => {
      const parsed = loadPlaylistSchema.safeParse(payload);
      if (!parsed.success) return;
      const room = rooms.getRoomByMember(socket.id);
      if (!room || !rooms.isHost(room.code, socket.id)) return;
      const userId = (socket.data as { userId?: string }).userId;
      if (!userId) return;
      const playlist = playlistRepo.findById(parsed.data.playlistId);
      if (!playlist || playlist.ownerUserId !== userId) return;
      const addedBy = nameOf(socket.id, room.code);
      for (const it of playlist.items) {
        rooms.addToQueue(room.code, { videoId: it.videoId, title: it.title, addedBy });
      }
      const updated = rooms.getRoom(room.code);
      if (updated) io.to(room.code).emit('room:state', updated);
      if (updated && !updated.playback.videoId) {
        const pb = rooms.advanceQueue(room.code, Date.now());
        io.to(room.code).emit('playback:update', pb);
        const after = rooms.getRoom(room.code);
        if (after) io.to(room.code).emit('room:state', after);
      }
    });
```

- [ ] **Step 5: Write `server/src/db/playlistRepo.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrate, type DB } from './db.js';
import { createUserRepo } from './userRepo.js';
import { createPlaylistRepo } from './playlistRepo.js';

describe('playlistRepo', () => {
  let db: DB;
  let repo: ReturnType<typeof createPlaylistRepo>;
  let ownerId: string;
  beforeEach(() => {
    db = openDb(':memory:'); migrate(db);
    ownerId = createUserRepo(db).create('a@b.com', 'h', 'Alice').id;
    repo = createPlaylistRepo(db);
  });

  it('creates a playlist with ordered items', () => {
    const pl = repo.create(ownerId, 'Chill', [
      { videoId: 'dQw4w9WgXcQ', title: 'A' },
      { videoId: 'oHg5SJYRHA0', title: 'B' },
    ]);
    const found = repo.findById(pl.id);
    expect(found?.items.map((i) => i.title)).toEqual(['A', 'B']);
  });

  it('lists by owner and deletes with ownership check', () => {
    const pl = repo.create(ownerId, 'Chill', [{ videoId: 'dQw4w9WgXcQ', title: 'A' }]);
    expect(repo.listByOwner(ownerId)).toHaveLength(1);
    expect(repo.deleteById(pl.id, 'other')).toBe(false);
    expect(repo.deleteById(pl.id, ownerId)).toBe(true);
    expect(repo.findById(pl.id)).toBeNull();
  });
});
```

- [ ] **Step 6: Write `server/src/api/playlistRoutes.test.ts`**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { openDb, migrate } from '../db/db.js';
import { createServer } from '../index.js';

async function cookieFor(base: string, email = 'a@b.com'): Promise<string> {
  const reg = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password1', displayName: 'Alice' }),
  });
  return reg.headers.get('set-cookie')!;
}

describe('playlist routes', () => {
  let server: ReturnType<typeof createServer>;
  afterEach(async () => { await server.close(); });
  function start() {
    const db = openDb(':memory:'); migrate(db);
    server = createServer(0, db);
    return `http://localhost:${(server.httpServer.address() as { port: number }).port}`;
  }

  it('saves and lists a playlist for the owner', async () => {
    const base = start();
    const cookie = await cookieFor(base);
    const create = await fetch(`${base}/api/playlists`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Chill', items: [{ videoId: 'dQw4w9WgXcQ', title: 'A' }] }),
    });
    expect(create.status).toBe(200);
    const list = await fetch(`${base}/api/playlists`, { headers: { cookie } });
    const { playlists } = await list.json();
    expect(playlists[0].name).toBe('Chill');
    expect(playlists[0].items).toHaveLength(1);
  });

  it('rejects an invalid videoId', async () => {
    const base = start();
    const cookie = await cookieFor(base);
    const create = await fetch(`${base}/api/playlists`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Chill', items: [{ videoId: 'bad', title: 'A' }] }),
    });
    expect(create.status).toBe(400);
  });
});
```

- [ ] **Step 7: Run tests**

Run: `npm run test --workspace server`
Expected: playlistRepo and playlist routes tests PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Add playlists: repo, REST routes, and host-only load-into-queue"
```

---

### Task 7: Listening history — historyRepo, logging on track start, REST route

**Files:**
- Create: `server/src/db/historyRepo.ts`
- Create: `server/src/api/historyRoutes.ts`
- Modify: `server/src/index.ts` (mount history route; log on track start)
- Test: `server/src/db/historyRepo.test.ts`
- Test: `server/src/api/historyRoutes.test.ts`

**Interfaces:**
- Produces:
  - `historyRepo.ts`: `interface HistoryEntry { videoId: string; title: string; playedAt: number }`; `createHistoryRepo(db)` returning `{ add(userId, videoId, title): void; listByUser(userId, limit?): HistoryEntry[] }` (default limit 200, most recent first).
  - `historyRoutes.ts`: `createHistoryRouter(historyRepo): Router`.
  - `index.ts`: a helper `logTrackStart(code, videoId, title)` that writes a history row for each authed member of the live room.

- [ ] **Step 1: Write `server/src/db/historyRepo.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';

export interface HistoryEntry {
  videoId: string;
  title: string;
  playedAt: number;
}

interface HistoryRow { video_id: string; title: string; played_at: number; }

export function createHistoryRepo(db: DB) {
  const insert = db.prepare('INSERT INTO history (id, user_id, video_id, title, played_at) VALUES (?, ?, ?, ?, ?)');
  const byUser = db.prepare('SELECT video_id, title, played_at FROM history WHERE user_id = ? ORDER BY played_at DESC LIMIT ?');

  return {
    add(userId: string, videoId: string, title: string): void {
      insert.run(randomUUID(), userId, videoId, title, Date.now());
    },
    listByUser(userId: string, limit = 200): HistoryEntry[] {
      return (byUser.all(userId, limit) as HistoryRow[]).map((r) => ({ videoId: r.video_id, title: r.title, playedAt: r.played_at }));
    },
  };
}
```

- [ ] **Step 2: Write `server/src/api/historyRoutes.ts`**

```ts
import { Router, type Request } from 'express';
import type { createHistoryRepo } from '../db/historyRepo.js';

export function createHistoryRouter(historyRepo: ReturnType<typeof createHistoryRepo>): Router {
  const router = Router();
  router.get('/', (req, res) => {
    const userId = (req as Request & { userId?: string }).userId;
    if (!userId) return res.status(401).json({ error: 'Log in to view history.' });
    res.json({ history: historyRepo.listByUser(userId) });
  });
  return router;
}
```

- [ ] **Step 3: Wire history into `server/src/index.ts`**

Add imports:

```ts
import { createHistoryRepo } from './db/historyRepo.js';
import { createHistoryRouter } from './api/historyRoutes.js';
```

After `const playlistRepo = createPlaylistRepo(db);` add:

```ts
  const historyRepo = createHistoryRepo(db);
```

After the `/api/playlists` mount add:

```ts
  app.use('/api/history', createHistoryRouter(historyRepo));
```

Add a helper before `io.on('connection', ...)` that logs a starting track for authed members:

```ts
  function logTrackStart(code: string, videoId: string | null, title: string) {
    if (!videoId) return;
    const room = rooms.getRoom(code);
    if (!room) return;
    for (const member of room.members) {
      const memberSocket = io.sockets.sockets.get(member.id);
      const uid = memberSocket ? (memberSocket.data as { userId?: string }).userId : undefined;
      if (uid) historyRepo.add(uid, videoId, title);
    }
  }
```

Call it wherever a new track becomes current. In `queue:add` auto-start, `queue:next`, and `queue:loadPlaylist` auto-start blocks, after computing `pb` from `advanceQueue`, add the log. Concretely, in `queue:next`:

```ts
    socket.on('queue:next', () =>
      hostAction((code) => {
        const pb = rooms.advanceQueue(code, Date.now());
        io.to(code).emit('playback:update', pb);
        if (pb.videoId) logTrackStart(code, pb.videoId, titleOf(code, pb.videoId));
        const room = rooms.getRoom(code);
        if (room) io.to(code).emit('room:state', room);
      }),
    );
```

Add a small helper `titleOf` near `nameOf` (the queue item was already shifted, so fall back to the videoId):

```ts
  function titleOf(_code: string, videoId: string): string {
    return videoId; // queue item already dequeued; title tracking beyond id is out of scope for history
  }
```

Apply the same `logTrackStart(code, pb.videoId, titleOf(code, pb.videoId))` call after the `advanceQueue` in the `queue:add` auto-start block and the `queue:loadPlaylist` auto-start block.

- [ ] **Step 4: Write `server/src/db/historyRepo.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrate, type DB } from './db.js';
import { createUserRepo } from './userRepo.js';
import { createHistoryRepo } from './historyRepo.js';

describe('historyRepo', () => {
  let db: DB;
  let repo: ReturnType<typeof createHistoryRepo>;
  let uid: string;
  beforeEach(() => {
    db = openDb(':memory:'); migrate(db);
    uid = createUserRepo(db).create('a@b.com', 'h', 'Alice').id;
    repo = createHistoryRepo(db);
  });

  it('records and returns history most-recent-first', () => {
    repo.add(uid, 'dQw4w9WgXcQ', 'First');
    repo.add(uid, 'oHg5SJYRHA0', 'Second');
    const list = repo.listByUser(uid);
    expect(list).toHaveLength(2);
    expect(list[0].title).toBe('Second');
  });

  it('scopes history to the user', () => {
    const other = createUserRepo(db).create('b@b.com', 'h', 'Bob').id;
    repo.add(uid, 'dQw4w9WgXcQ', 'Mine');
    expect(repo.listByUser(other)).toHaveLength(0);
  });
});
```

- [ ] **Step 5: Write `server/src/api/historyRoutes.test.ts`**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import { openDb, migrate } from '../db/db.js';
import { createServer } from '../index.js';
import { signToken } from '../auth/token.js';
import { COOKIE_NAME } from '../auth/routes.js';
import type { CreateJoinResult } from '@wavelength/shared';

describe('history logging + route', () => {
  let server: ReturnType<typeof createServer>;
  const sockets: Socket[] = [];
  afterEach(async () => { sockets.forEach((s) => s.close()); sockets.length = 0; await server.close(); });

  function start() {
    const db = openDb(':memory:'); migrate(db);
    server = createServer(0, db);
    const port = (server.httpServer.address() as { port: number }).port;
    return { base: `http://localhost:${port}`, port, db };
  }
  function connect(port: number, cookie?: string): Promise<Socket> {
    return new Promise((resolve) => {
      const s = ioc(`http://localhost:${port}`, { transports: ['websocket'], extraHeaders: cookie ? { cookie } : undefined });
      s.on('connect', () => resolve(s));
    });
  }

  it('logs a played track for an authed host and exposes it via /api/history', async () => {
    const { base, port } = start();
    // register to create a real user id, capture cookie + id
    const reg = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@b.com', password: 'password1', displayName: 'Alice' }) });
    const cookie = reg.headers.get('set-cookie')!.split(';')[0]; // wl_token=...
    const me = await (await fetch(`${base}/api/auth/me`, { headers: { cookie } })).json();
    const token = signToken({ userId: me.user.id });

    const host = await connect(port, `${COOKIE_NAME}=${token}`);
    sockets.push(host);
    const created = await new Promise<CreateJoinResult>((r) => host.emit('room:create', { name: 'Alice' }, r));
    if (!created.ok) throw new Error('create failed');

    host.emit('queue:add', { videoId: 'dQw4w9WgXcQ', title: 'Song' }); // auto-starts
    await new Promise((r) => setTimeout(r, 200));

    const hist = await (await fetch(`${base}/api/history`, { headers: { cookie } })).json();
    expect(hist.history.length).toBeGreaterThanOrEqual(1);
    expect(hist.history[0].videoId).toBe('dQw4w9WgXcQ');
  });
});
```

- [ ] **Step 6: Run tests**

Run: `npm run test --workspace server`
Expected: historyRepo and history logging tests PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add listening history: repo, per-track logging, and REST route"
```

---

### Task 8: Client — AuthContext, API helper, auth UI, socket credentials

**Files:**
- Create: `client/src/auth/api.ts`
- Create: `client/src/auth/AuthContext.tsx`
- Create: `client/src/auth/AuthPanel.tsx`
- Modify: `client/src/socket.ts` (withCredentials)
- Modify: `client/src/main.tsx` (wrap in AuthProvider)
- Modify: `client/src/styles.css` (auth styles)

**Interfaces:**
- Produces:
  - `api.ts`: typed fetch helpers — `apiGet<T>(path): Promise<T>`, `apiPost<T>(path, body): Promise<T>`, `apiDelete<T>(path): Promise<T>`; all use `credentials: 'include'`; throw `ApiError { status, message }` on non-2xx.
  - `AuthContext.tsx`: `interface AuthUser { id: string; email: string; displayName: string }`; `useAuth()` returning `{ user: AuthUser | null; loading: boolean; login(email, password): Promise<void>; register(email, password, displayName): Promise<void>; logout(): Promise<void> }`; `AuthProvider` component.
  - `AuthPanel.tsx`: `AuthPanel` component (login/register toggle form) — self-contained, uses `useAuth`.

- [ ] **Step 1: Set `withCredentials` in `client/src/socket.ts`**

```ts
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@wavelength/shared';

const URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(URL, {
  transports: ['websocket'],
  autoConnect: true,
  withCredentials: true,
});

export default socket;
```

- [ ] **Step 2: Write `client/src/auth/api.ts`**

```ts
const BASE = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function handle<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? 'Request failed');
  return data as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return fetch(`${BASE}${path}`, { credentials: 'include' }).then(handle<T>);
}
export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return fetch(`${BASE}${path}`, {
    method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(handle<T>);
}
export function apiDelete<T>(path: string): Promise<T> {
  return fetch(`${BASE}${path}`, { method: 'DELETE', credentials: 'include' }).then(handle<T>);
}
```

- [ ] **Step 3: Write `client/src/auth/AuthContext.tsx`**

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiGet, apiPost } from './api.js';

export interface AuthUser { id: string; email: string; displayName: string; }

interface AuthValue {
  user: AuthUser | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string, displayName: string): Promise<void>;
  logout(): Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<{ user: AuthUser | null }>('/api/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const u = await apiPost<AuthUser>('/api/auth/login', { email, password });
    setUser(u);
  }
  async function register(email: string, password: string, displayName: string) {
    const u = await apiPost<AuthUser>('/api/auth/register', { email, password, displayName });
    setUser(u);
  }
  async function logout() {
    await apiPost('/api/auth/logout', {});
    setUser(null);
  }

  return <Ctx.Provider value={{ user, loading, login, register, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used within AuthProvider');
  return v;
}
```

- [ ] **Step 4: Write `client/src/auth/AuthPanel.tsx`**

```tsx
import { useState } from 'react';
import { useAuth } from './AuthContext.js';
import { ApiError } from './api.js';

export default function AuthPanel() {
  const { user, login, register, logout } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) {
    return (
      <div className="auth-panel">
        <span>Signed in as <b>{user.displayName}</b></span>
        <button onClick={() => logout()}>Log out</button>
      </div>
    );
  }

  async function submit() {
    setBusy(true); setError('');
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password, displayName);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-panel">
      <div className="auth-tabs">
        <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Log in</button>
        <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Sign up</button>
      </div>
      {mode === 'register' && (
        <input placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} />
      )}
      <input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button onClick={submit} disabled={busy}>{mode === 'login' ? 'Log in' : 'Create account'}</button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 5: Wrap the app in `AuthProvider` in `client/src/main.tsx`**

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import { AuthProvider } from './auth/AuthContext.js';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 6: Append auth styles to `client/src/styles.css`**

```css
.auth-panel { background: #16162e; border: 1px solid #2a2a4a; border-radius: 10px; padding: 12px; margin: 12px 0; display: flex; flex-direction: column; gap: 8px; }
.auth-panel .auth-tabs { display: flex; gap: 8px; }
.auth-panel .auth-tabs .active { background: #3a3a7a; }
.auth-panel input { width: 100%; }
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck --workspace client`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Add client auth: context, API helper, auth panel, socket credentials"
```

---

### Task 9: Client — account features on Landing and in Room

**Files:**
- Create: `client/src/AccountPanel.tsx`
- Modify: `client/src/Landing.tsx` (render AuthPanel + AccountPanel)
- Modify: `client/src/Room.tsx` (host playlist controls)
- Modify: `client/src/styles.css`

**Interfaces:**
- Consumes: `useAuth`, `apiGet`/`apiPost`/`apiDelete`, `socket`, shared types.
- Produces: `AccountPanel` component with prop `onOpenRoom(code: string, name: string): void` (opens a saved room by joining its code). Room gains playlist save/load using `apiPost('/api/playlists', ...)`, `apiGet('/api/playlists')`, and `socket.emit('queue:loadPlaylist', { playlistId })`.

- [ ] **Step 1: Write `client/src/AccountPanel.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useAuth } from './auth/AuthContext.js';
import { apiGet, apiPost, apiDelete } from './auth/api.js';

interface SavedRoom { code: string; name: string; }
interface Playlist { id: string; name: string; items: { videoId: string; title: string }[]; }
interface HistoryEntry { videoId: string; title: string; playedAt: number; }

export default function AccountPanel({ onJoin }: { onJoin: (code: string) => void }) {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<SavedRoom[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [newRoomName, setNewRoomName] = useState('');

  useEffect(() => {
    if (!user) return;
    apiGet<{ rooms: SavedRoom[] }>('/api/rooms').then((r) => setRooms(r.rooms)).catch(() => {});
    apiGet<{ playlists: Playlist[] }>('/api/playlists').then((r) => setPlaylists(r.playlists)).catch(() => {});
    apiGet<{ history: HistoryEntry[] }>('/api/history').then((r) => setHistory(r.history)).catch(() => {});
  }, [user]);

  if (!user) return null;

  async function createRoom() {
    if (!newRoomName.trim()) return;
    const r = await apiPost<SavedRoom>('/api/rooms', { name: newRoomName.trim() });
    setRooms((prev) => [{ code: r.code, name: r.name }, ...prev]);
    setNewRoomName('');
  }
  async function removeRoom(code: string) {
    await apiDelete(`/api/rooms/${code}`);
    setRooms((prev) => prev.filter((r) => r.code !== code));
  }

  return (
    <div className="account">
      <div className="panel">
        <h3>Your saved rooms</h3>
        <div className="add-song">
          <input placeholder="New room name" value={newRoomName} onChange={(e) => setNewRoomName(e.target.value)} maxLength={60} />
          <button onClick={createRoom}>Create</button>
        </div>
        <ul>{rooms.map((r) => (
          <li key={r.code}>
            <button onClick={() => onJoin(r.code)}>{r.name} ({r.code})</button>
            <button onClick={() => removeRoom(r.code)}>✕</button>
          </li>
        ))}</ul>
      </div>

      <div className="panel">
        <h3>Your playlists</h3>
        <ul>{playlists.map((p) => <li key={p.id}>{p.name} <small>({p.items.length})</small></li>)}</ul>
      </div>

      <div className="panel">
        <h3>Recently played</h3>
        <ol>{history.slice(0, 20).map((h, i) => <li key={i}>{h.title}</li>)}</ol>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Render AuthPanel + AccountPanel in `client/src/Landing.tsx`**

Add imports at the top:

```tsx
import { useAuth } from './auth/AuthContext.js';
import AuthPanel from './auth/AuthPanel.js';
import AccountPanel from './AccountPanel.js';
```

Inside the component, get auth and add an auto-join helper. Add after the `busy` state:

```tsx
  const { user } = useAuth();

  function joinByCode(roomCode: string) {
    if (!name.trim()) { setError('Enter a name first, then open your room.'); return; }
    setBusy(true); setError('');
    socket.emit('room:join', { code: roomCode, name: name.trim() }, handle);
  }
```

Then in the returned JSX, add `<AuthPanel />` right below the tagline, and `{user && <AccountPanel onJoin={joinByCode} />}` below the join-row:

```tsx
      <p className="tagline">Get on the same wavelength.</p>
      <AuthPanel />
      <label>Your name<br />
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Alex" />
      </label>
      <div className="actions">
        <button onClick={create} disabled={busy}>Create a room</button>
      </div>
      <div className="join-row">
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ROOM CODE" maxLength={6} />
        <button onClick={join} disabled={busy}>Join</button>
      </div>
      {user && <AccountPanel onJoin={joinByCode} />}
      {error && <p className="error">{error}</p>}
```

Also widen the landing container so the account panels fit: in `styles.css` change `.landing { max-width: 420px; ... }` to `max-width: 520px;`.

- [ ] **Step 3: Add host playlist controls in `client/src/Room.tsx`**

Add imports:

```tsx
import { useAuth } from './auth/AuthContext.js';
import { apiGet, apiPost } from './auth/api.js';
```

Inside `Room`, after existing state, add:

```tsx
  const { user } = useAuth();
  const [playlists, setPlaylists] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (user && isHost) apiGet<{ playlists: { id: string; name: string }[] }>('/api/playlists').then((r) => setPlaylists(r.playlists)).catch(() => {});
  }, [user, isHost]);

  async function saveQueueAsPlaylist() {
    const name = window.prompt('Playlist name?');
    if (!name) return;
    const items = state.queue.map((q) => ({ videoId: q.videoId, title: q.title }));
    if (state.playback.videoId) items.unshift({ videoId: state.playback.videoId, title: state.playback.videoId });
    await apiPost('/api/playlists', { name, items });
    const r = await apiGet<{ playlists: { id: string; name: string }[] }>('/api/playlists');
    setPlaylists(r.playlists);
  }

  function loadPlaylist(id: string) {
    socket.emit('queue:loadPlaylist', { playlistId: id });
  }
```

Then render these controls inside the host `controls` block (only when `user` is set):

```tsx
          {isHost && (
            <div className="controls">
              <button onClick={hostPlay}>Play</button>
              <button onClick={hostPause}>Pause</button>
              <button onClick={hostNext}>Skip ▶▶</button>
              {user && <button onClick={saveQueueAsPlaylist}>Save queue</button>}
              {user && playlists.length > 0 && (
                <select onChange={(e) => { if (e.target.value) loadPlaylist(e.target.value); e.target.value = ''; }} defaultValue="">
                  <option value="" disabled>Load playlist…</option>
                  {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
            </div>
          )}
```

Ensure `useState`/`useEffect` are already imported (they are).

- [ ] **Step 4: Add account styles to `client/src/styles.css`**

```css
.account { text-align: left; margin-top: 16px; }
.account li { display: flex; gap: 6px; align-items: center; justify-content: space-between; margin: 4px 0; }
.account li button:first-child { flex: 1; text-align: left; }
select { border-radius: 8px; border: 1px solid #3a3a5a; background: #16162e; color: #e8e8f0; padding: 8px 10px; }
```

- [ ] **Step 5: Typecheck and build**

Run: `npm run typecheck --workspace client && npm run build --workspace client`
Expected: clean typecheck, successful build.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add account UI: saved rooms, playlists, history, and host controls"
```

---

### Task 10: End-to-end verification + docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update `README.md`**

Add an "Accounts (Phase 2a)" section describing: register/login, saved rooms, playlists, and history; and document env vars. Insert after the "Run locally" section:

````markdown
## Accounts (Phase 2a)

Accounts are optional — guests can still create/join rooms with just a name.
Signing up (email + password) unlocks:

- **Saved rooms** — a permanent room with a stable code you can reopen anytime.
- **Playlists** — save the current queue and load it into any room you host.
- **Listening history** — a personal log of what played in rooms you were in.

### Configuration

Copy `.env.example` to `.env` in the repo root and set values before running the server:

- `JWT_SECRET` — required in production; the server refuses to start without it.
- `CLIENT_ORIGIN` — the client URL allowed by CORS (default `http://localhost:5173`).
- `DB_PATH` — SQLite file path (default `wavelength.sqlite`).
- `PORT` — server port (default `3001`).
````

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: shared, server (all repo/route/socket/history suites), and client suites PASS.

- [ ] **Step 3: Full manual E2E test**

1. Copy `.env.example` to `.env`; start server and client.
2. On the landing page, click **Sign up**, register with an email/password/name — confirm you become "Signed in as <name>".
3. Under **Your saved rooms**, create a room; enter your display name; click the saved room to open it. Confirm you enter a room whose code matches.
4. Add a couple of YouTube songs; as host click **Save queue** and name it. Reload the page — under **Your playlists** the new playlist appears.
5. Open the saved room again, click **Load playlist…**, pick it — confirm the queue fills and playback starts.
6. Under **Recently played**, confirm the songs you listened to appear.
7. Open a second browser (no login), join the room as a guest by code — confirm sync + chat still work and no history is recorded for the guest.
8. Log out — confirm account panels disappear and guest create/join still work.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Document Phase 2a accounts and finalize"
```

---

## Self-Review Notes

- **Spec coverage:** accounts/auth (Tasks 1–4), guest-unaffected (Task 4 + unchanged handlers), saved rooms incl. reactivation (Task 5), playlists incl. host-only load (Task 6), history logging + route (Task 7), client auth + account UI (Tasks 8–9), security requirements (bcryptjs/JWT/cookie/CORS/zod/rate-limit across Tasks 1–3, ownership checks in Tasks 5–6), testing strategy (unit + integration across all server tasks), env/gitignore (Task 1), docs (Task 10). All spec sections map to tasks.
- **Type consistency:** `createServer(port?, injectedDb?)` returns `{ io, httpServer, db, rooms, close }` and is used that way in every server test; repo factory names (`createUserRepo`/`createRoomRepo`/`createPlaylistRepo`/`createHistoryRepo`) and their method signatures are stable across tasks; `COOKIE_NAME` shared between routes and index/tests; `queue:loadPlaylist` added to `ClientToServerEvents` before use.
- **Placeholder scan:** no TBD/TODO; each code step contains full code. The one intentional simplification (history stores the videoId as the title once a track is dequeued) is documented in `titleOf` and is acceptable for v2a since the queue item is already removed when the track becomes current.
- **Known limitation (documented, not a gap):** history title fidelity is limited to the videoId for tracks logged at advance-time; richer titles are a later enhancement.
