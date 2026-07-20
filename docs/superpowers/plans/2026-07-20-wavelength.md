# Wavelength Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build v1 of Wavelength — a web app where friends join a room by code and listen to the same YouTube song in perfect sync, with a host-controlled player, a shared queue anyone can add to, and live chat.

**Architecture:** A Node + Socket.IO server is the source of truth for each room's playback state and relays queue/chat events; rooms live in an in-memory `Map`. A React + Vite client embeds the YouTube IFrame Player and reconciles its position against the server using a clock-offset handshake plus a host heartbeat for drift correction. Shared TypeScript types keep the wire contract identical on both ends.

**Tech Stack:** TypeScript everywhere. Server: Node, Express, Socket.IO, Vitest. Client: React, Vite, socket.io-client. Shared: a workspace package of types + pure sync-math functions.

## Global Constraints

- **Language:** TypeScript on client, server, and shared. `strict: true` in every tsconfig.
- **No database, no auth.** All room state is in-memory and ephemeral; a room is deleted when its last member leaves.
- **Music source:** YouTube only (IFrame Player API). No Spotify/local files in v1.
- **Control model:** only the host emits playback control events; any member may add to the queue or chat.
- **Node version floor:** Node 20+ (for stable ESM + built-in `crypto.randomUUID`).
- **Module system:** ESM (`"type": "module"`) in all packages.
- **Chat + queue payload caps:** chat text trimmed and capped at 500 chars; reject empty. `videoId` validated as 11-char YouTube id.
- **Naming:** socket events use the `domain:action` convention exactly as defined in `shared/src/events.ts`.

---

### Task 1: Workspace scaffolding & shared types

**Files:**
- Create: `package.json` (root, workspaces)
- Create: `.gitignore`
- Create: `tsconfig.base.json`
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Create: `shared/src/events.ts`
- Create: `shared/src/sync.ts`
- Create: `shared/src/index.ts`
- Test: `shared/src/sync.test.ts`

**Interfaces:**
- Produces: all shared types (`Member`, `QueueItem`, `PlaybackState`, `RoomState`, `ChatMessage`, `CreateJoinResult`, `ClientToServerEvents`, `ServerToClientEvents`) and pure functions `estimateOffset`, `effectivePosition`, `isDrifted`, `isValidVideoId`.

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "wavelength",
  "private": true,
  "type": "module",
  "workspaces": ["shared", "server", "client"],
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "dev:server": "npm run dev --workspace server",
    "dev:client": "npm run dev --workspace client"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
dist/
.env
*.log
.DS_Store
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "verbatimModuleSyntax": true
  }
}
```

- [ ] **Step 4: Create `shared/package.json`**

```json
{
  "name": "@wavelength/shared",
  "version": "1.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 5: Create `shared/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "rootDir": "./src", "noEmit": true },
  "include": ["src"]
}
```

- [ ] **Step 6: Write `shared/src/events.ts`**

```ts
export interface Member {
  id: string;
  name: string;
}

export interface QueueItem {
  videoId: string;
  title: string;
  addedBy: string;
}

export interface PlaybackState {
  videoId: string | null;
  isPlaying: boolean;
  positionSec: number;
  lastUpdateServerTs: number;
}

export interface RoomState {
  code: string;
  hostId: string;
  members: Member[];
  queue: QueueItem[];
  playback: PlaybackState;
}

export interface ChatMessage {
  name: string;
  text: string;
  ts: number;
}

export type CreateJoinResult =
  | { ok: true; state: RoomState; selfId: string }
  | { ok: false; error: string };

export interface ClientToServerEvents {
  'room:create': (payload: { name: string }, cb: (res: CreateJoinResult) => void) => void;
  'room:join': (payload: { code: string; name: string }, cb: (res: CreateJoinResult) => void) => void;
  'playback:play': (payload: { positionSec: number }) => void;
  'playback:pause': (payload: { positionSec: number }) => void;
  'playback:seek': (payload: { positionSec: number }) => void;
  'playback:heartbeat': (payload: { positionSec: number }) => void;
  'queue:add': (payload: { videoId: string; title: string }) => void;
  'queue:next': () => void;
  'chat:send': (payload: { text: string }) => void;
  'time:ping': (payload: { t0: number }, cb: (res: { t0: number; serverTime: number }) => void) => void;
}

export interface ServerToClientEvents {
  'room:state': (state: RoomState) => void;
  'playback:update': (playback: PlaybackState) => void;
  'chat:message': (msg: ChatMessage) => void;
}
```

- [ ] **Step 7: Write `shared/src/sync.ts`**

```ts
import type { PlaybackState } from './events.js';

/** NTP-style clock offset estimate. serverTime is the server clock when it replied. */
export function estimateOffset(t0: number, t1: number, serverTime: number): number {
  return serverTime - (t0 + t1) / 2;
}

/** True playback position at serverNow (ms epoch, server clock). */
export function effectivePosition(playback: PlaybackState, serverNow: number): number {
  if (!playback.isPlaying) return playback.positionSec;
  return playback.positionSec + (serverNow - playback.lastUpdateServerTs) / 1000;
}

/** Whether the player has drifted beyond threshold (seconds). */
export function isDrifted(actualSec: number, expectedSec: number, thresholdSec = 1): boolean {
  return Math.abs(actualSec - expectedSec) > thresholdSec;
}

/** YouTube video ids are 11 chars of [A-Za-z0-9_-]. */
export function isValidVideoId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id);
}
```

- [ ] **Step 8: Write `shared/src/index.ts`**

```ts
export * from './events.js';
export * from './sync.js';
```

- [ ] **Step 9: Write the failing test `shared/src/sync.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { estimateOffset, effectivePosition, isDrifted, isValidVideoId } from './sync.js';

describe('estimateOffset', () => {
  it('centers on the round-trip midpoint', () => {
    // t0=1000, t1=1200 -> midpoint 1100; server said 1150 -> offset 50
    expect(estimateOffset(1000, 1200, 1150)).toBe(50);
  });
});

describe('effectivePosition', () => {
  it('returns positionSec unchanged when paused', () => {
    const p = { videoId: 'x', isPlaying: false, positionSec: 42, lastUpdateServerTs: 1000 };
    expect(effectivePosition(p, 9999)).toBe(42);
  });

  it('advances by elapsed seconds when playing', () => {
    const p = { videoId: 'x', isPlaying: true, positionSec: 10, lastUpdateServerTs: 1000 };
    // 3500ms later -> 10 + 3.5 = 13.5
    expect(effectivePosition(p, 4500)).toBe(13.5);
  });
});

describe('isDrifted', () => {
  it('is false within threshold', () => {
    expect(isDrifted(10, 10.4)).toBe(false);
  });
  it('is true beyond threshold', () => {
    expect(isDrifted(10, 12)).toBe(true);
  });
});

describe('isValidVideoId', () => {
  it('accepts an 11-char id', () => {
    expect(isValidVideoId('dQw4w9WgXcQ')).toBe(true);
  });
  it('rejects wrong length or type', () => {
    expect(isValidVideoId('short')).toBe(false);
    expect(isValidVideoId(123)).toBe(false);
  });
});
```

- [ ] **Step 10: Install and run tests**

Run:
```bash
npm install
npm run test --workspace shared
```
Expected: all sync tests PASS.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "Add workspace scaffolding, shared types, and sync math"
```

---

### Task 2: Server RoomManager (pure logic)

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/src/roomManager.ts`
- Test: `server/src/roomManager.test.ts`

**Interfaces:**
- Consumes: `RoomState`, `PlaybackState`, `QueueItem`, `Member` from `@wavelength/shared`.
- Produces: class `RoomManager` with methods:
  - `createRoom(hostId: string, hostName: string): RoomState`
  - `joinRoom(code: string, id: string, name: string): RoomState` (throws `Error` with message `'ROOM_NOT_FOUND'` or `'NAME_TAKEN'`)
  - `leaveRoom(id: string): { code: string; state: RoomState | null } | null` (state is null if room deleted)
  - `addToQueue(code: string, item: QueueItem): RoomState`
  - `advanceQueue(code: string, serverTs: number): PlaybackState` (pops next; empty queue -> stopped)
  - `setPlayback(code: string, patch: { isPlaying?: boolean; positionSec: number }, serverTs: number): PlaybackState`
  - `getRoomByMember(id: string): RoomState | null`
  - `getRoom(code: string): RoomState | null`
  - `isHost(code: string, id: string): boolean`

- [ ] **Step 1: Create `server/package.json`**

```json
{
  "name": "@wavelength/server",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@wavelength/shared": "*",
    "express": "^4.19.0",
    "socket.io": "^4.7.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "socket.io-client": "^4.7.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `server/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "rootDir": "./src", "noEmit": true },
  "include": ["src"]
}
```

- [ ] **Step 3: Write the failing test `server/src/roomManager.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { RoomManager } from './roomManager.js';

describe('RoomManager', () => {
  let mgr: RoomManager;
  beforeEach(() => {
    // deterministic codes for tests
    let n = 0;
    mgr = new RoomManager(() => `ROOM${n++}`);
  });

  it('creates a room with the creator as host and sole member', () => {
    const state = mgr.createRoom('h1', 'Alice');
    expect(state.code).toBe('ROOM0');
    expect(state.hostId).toBe('h1');
    expect(state.members).toEqual([{ id: 'h1', name: 'Alice' }]);
    expect(state.playback.videoId).toBeNull();
  });

  it('lets a second person join', () => {
    mgr.createRoom('h1', 'Alice');
    const state = mgr.joinRoom('ROOM0', 'u2', 'Bob');
    expect(state.members).toHaveLength(2);
  });

  it('rejects joining an unknown room', () => {
    expect(() => mgr.joinRoom('NOPE', 'u2', 'Bob')).toThrow('ROOM_NOT_FOUND');
  });

  it('rejects a duplicate name in the same room', () => {
    mgr.createRoom('h1', 'Alice');
    expect(() => mgr.joinRoom('ROOM0', 'u2', 'Alice')).toThrow('NAME_TAKEN');
  });

  it('promotes the next member to host when the host leaves', () => {
    mgr.createRoom('h1', 'Alice');
    mgr.joinRoom('ROOM0', 'u2', 'Bob');
    const res = mgr.leaveRoom('h1');
    expect(res?.state?.hostId).toBe('u2');
    expect(res?.state?.members).toHaveLength(1);
  });

  it('deletes the room when the last member leaves', () => {
    mgr.createRoom('h1', 'Alice');
    const res = mgr.leaveRoom('h1');
    expect(res?.state).toBeNull();
    expect(mgr.getRoom('ROOM0')).toBeNull();
  });

  it('appends to the queue', () => {
    mgr.createRoom('h1', 'Alice');
    const state = mgr.addToQueue('ROOM0', { videoId: 'dQw4w9WgXcQ', title: 'Song', addedBy: 'Alice' });
    expect(state.queue).toHaveLength(1);
  });

  it('advances the queue and stamps playback', () => {
    mgr.createRoom('h1', 'Alice');
    mgr.addToQueue('ROOM0', { videoId: 'dQw4w9WgXcQ', title: 'Song', addedBy: 'Alice' });
    const pb = mgr.advanceQueue('ROOM0', 5000);
    expect(pb.videoId).toBe('dQw4w9WgXcQ');
    expect(pb.isPlaying).toBe(true);
    expect(pb.positionSec).toBe(0);
    expect(pb.lastUpdateServerTs).toBe(5000);
  });

  it('advancing an empty queue stops playback', () => {
    mgr.createRoom('h1', 'Alice');
    const pb = mgr.advanceQueue('ROOM0', 5000);
    expect(pb.videoId).toBeNull();
    expect(pb.isPlaying).toBe(false);
  });

  it('setPlayback stamps position and time', () => {
    mgr.createRoom('h1', 'Alice');
    mgr.addToQueue('ROOM0', { videoId: 'dQw4w9WgXcQ', title: 'Song', addedBy: 'Alice' });
    mgr.advanceQueue('ROOM0', 1000);
    const pb = mgr.setPlayback('ROOM0', { isPlaying: false, positionSec: 30 }, 8000);
    expect(pb.isPlaying).toBe(false);
    expect(pb.positionSec).toBe(30);
    expect(pb.lastUpdateServerTs).toBe(8000);
  });

  it('isHost reflects the current host', () => {
    mgr.createRoom('h1', 'Alice');
    mgr.joinRoom('ROOM0', 'u2', 'Bob');
    expect(mgr.isHost('ROOM0', 'h1')).toBe(true);
    expect(mgr.isHost('ROOM0', 'u2')).toBe(false);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test --workspace server`
Expected: FAIL — cannot find `./roomManager.js`.

- [ ] **Step 5: Write `server/src/roomManager.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { RoomState, PlaybackState, QueueItem } from '@wavelength/shared';

function defaultGenCode(): string {
  return randomUUID().slice(0, 6).toUpperCase();
}

function emptyPlayback(): PlaybackState {
  return { videoId: null, isPlaying: false, positionSec: 0, lastUpdateServerTs: 0 };
}

export class RoomManager {
  private rooms = new Map<string, RoomState>();

  constructor(private genCode: () => string = defaultGenCode) {}

  createRoom(hostId: string, hostName: string): RoomState {
    let code = this.genCode();
    while (this.rooms.has(code)) code = this.genCode();
    const state: RoomState = {
      code,
      hostId,
      members: [{ id: hostId, name: hostName }],
      queue: [],
      playback: emptyPlayback(),
    };
    this.rooms.set(code, state);
    return state;
  }

  joinRoom(code: string, id: string, name: string): RoomState {
    const room = this.rooms.get(code);
    if (!room) throw new Error('ROOM_NOT_FOUND');
    if (room.members.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
      throw new Error('NAME_TAKEN');
    }
    room.members.push({ id, name });
    return room;
  }

  leaveRoom(id: string): { code: string; state: RoomState | null } | null {
    for (const room of this.rooms.values()) {
      const idx = room.members.findIndex((m) => m.id === id);
      if (idx === -1) continue;
      room.members.splice(idx, 1);
      if (room.members.length === 0) {
        this.rooms.delete(room.code);
        return { code: room.code, state: null };
      }
      if (room.hostId === id) room.hostId = room.members[0].id;
      return { code: room.code, state: room };
    }
    return null;
  }

  addToQueue(code: string, item: QueueItem): RoomState {
    const room = this.requireRoom(code);
    room.queue.push(item);
    return room;
  }

  advanceQueue(code: string, serverTs: number): PlaybackState {
    const room = this.requireRoom(code);
    const next = room.queue.shift();
    room.playback = next
      ? { videoId: next.videoId, isPlaying: true, positionSec: 0, lastUpdateServerTs: serverTs }
      : { ...emptyPlayback(), lastUpdateServerTs: serverTs };
    return room.playback;
  }

  setPlayback(
    code: string,
    patch: { isPlaying?: boolean; positionSec: number },
    serverTs: number,
  ): PlaybackState {
    const room = this.requireRoom(code);
    room.playback = {
      ...room.playback,
      positionSec: patch.positionSec,
      isPlaying: patch.isPlaying ?? room.playback.isPlaying,
      lastUpdateServerTs: serverTs,
    };
    return room.playback;
  }

  getRoom(code: string): RoomState | null {
    return this.rooms.get(code) ?? null;
  }

  getRoomByMember(id: string): RoomState | null {
    for (const room of this.rooms.values()) {
      if (room.members.some((m) => m.id === id)) return room;
    }
    return null;
  }

  isHost(code: string, id: string): boolean {
    return this.rooms.get(code)?.hostId === id;
  }

  private requireRoom(code: string): RoomState {
    const room = this.rooms.get(code);
    if (!room) throw new Error('ROOM_NOT_FOUND');
    return room;
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test --workspace server`
Expected: all RoomManager tests PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add server RoomManager with room lifecycle and queue logic"
```

---

### Task 3: Server Socket.IO wiring + integration test

**Files:**
- Create: `server/src/index.ts`
- Test: `server/src/socket.test.ts`

**Interfaces:**
- Consumes: `RoomManager` from Task 2; `ClientToServerEvents`, `ServerToClientEvents`, `isValidVideoId` from `@wavelength/shared`.
- Produces: `createServer(port?: number)` returning `{ io, httpServer, close }` for tests, and starts listening when run directly.

- [ ] **Step 1: Write the failing integration test `server/src/socket.test.ts`**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, CreateJoinResult } from '@wavelength/shared';
import { createServer } from './index.js';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

function connect(port: number): Promise<ClientSocket> {
  return new Promise((resolve) => {
    const s: ClientSocket = ioc(`http://localhost:${port}`, { transports: ['websocket'] });
    s.on('connect', () => resolve(s));
  });
}

describe('socket server', () => {
  let server: ReturnType<typeof createServer>;
  const sockets: ClientSocket[] = [];

  afterEach(async () => {
    sockets.forEach((s) => s.close());
    sockets.length = 0;
    await server.close();
  });

  it('creates a room and a second client can join it', async () => {
    server = createServer(0);
    const port = (server.httpServer.address() as { port: number }).port;

    const host = await connect(port);
    sockets.push(host);
    const created = await new Promise<CreateJoinResult>((res) =>
      host.emit('room:create', { name: 'Alice' }, res),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const code = created.state.code;

    const guest = await connect(port);
    sockets.push(guest);
    const joined = await new Promise<CreateJoinResult>((res) =>
      guest.emit('room:join', { code, name: 'Bob' }, res),
    );
    expect(joined.ok).toBe(true);
    if (joined.ok) expect(joined.state.members).toHaveLength(2);
  });

  it('broadcasts host playback to guests', async () => {
    server = createServer(0);
    const port = (server.httpServer.address() as { port: number }).port;

    const host = await connect(port);
    sockets.push(host);
    const created = await new Promise<CreateJoinResult>((res) =>
      host.emit('room:create', { name: 'Alice' }, res),
    );
    if (!created.ok) throw new Error('create failed');
    const code = created.state.code;

    const guest = await connect(port);
    sockets.push(guest);
    await new Promise<CreateJoinResult>((res) => guest.emit('room:join', { code, name: 'Bob' }, res));

    // host adds a song and advances, then guest should receive playback updates
    host.emit('queue:add', { videoId: 'dQw4w9WgXcQ', title: 'Song' });
    const update = await new Promise<{ videoId: string | null; isPlaying: boolean }>((res) => {
      guest.on('playback:update', (pb) => res(pb));
      host.emit('queue:next');
    });
    expect(update.videoId).toBe('dQw4w9WgXcQ');
    expect(update.isPlaying).toBe(true);
  });

  it('rejects playback control from a non-host', async () => {
    server = createServer(0);
    const port = (server.httpServer.address() as { port: number }).port;

    const host = await connect(port);
    sockets.push(host);
    const created = await new Promise<CreateJoinResult>((res) =>
      host.emit('room:create', { name: 'Alice' }, res),
    );
    if (!created.ok) throw new Error('create failed');
    const code = created.state.code;

    const guest = await connect(port);
    sockets.push(guest);
    await new Promise<CreateJoinResult>((res) => guest.emit('room:join', { code, name: 'Bob' }, res));

    // guest tries to pause; host should NOT see a playback:update from it
    let hostSawUpdate = false;
    host.on('playback:update', () => { hostSawUpdate = true; });
    guest.emit('playback:pause', { positionSec: 10 });
    await new Promise((r) => setTimeout(r, 150));
    expect(hostSawUpdate).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace server`
Expected: FAIL — cannot find `createServer` / `./index.js`.

- [ ] **Step 3: Write `server/src/index.ts`**

```ts
import { createServer as createHttpServer } from 'node:http';
import express from 'express';
import { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  CreateJoinResult,
} from '@wavelength/shared';
import { isValidVideoId } from '@wavelength/shared';
import { RoomManager } from './roomManager.js';

const MAX_CHAT_LEN = 500;

export function createServer(port = 3001) {
  const app = express();
  app.get('/health', (_req, res) => res.json({ ok: true }));

  const httpServer = createHttpServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: '*' },
  });
  const rooms = new RoomManager();

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
      hostAction((code) => {
        const pb = rooms.setPlayback(code, { isPlaying: true, positionSec }, Date.now());
        io.to(code).emit('playback:update', pb);
      }),
    );

    socket.on('playback:pause', ({ positionSec }) =>
      hostAction((code) => {
        const pb = rooms.setPlayback(code, { isPlaying: false, positionSec }, Date.now());
        io.to(code).emit('playback:update', pb);
      }),
    );

    socket.on('playback:seek', ({ positionSec }) =>
      hostAction((code) => {
        const pb = rooms.setPlayback(code, { positionSec }, Date.now());
        io.to(code).emit('playback:update', pb);
      }),
    );

    // heartbeat re-stamps position without forcing a re-seek broadcast type change
    socket.on('playback:heartbeat', ({ positionSec }) =>
      hostAction((code) => {
        const pb = rooms.setPlayback(code, { positionSec }, Date.now());
        io.to(code).emit('playback:update', pb);
      }),
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
      const updated = rooms.addToQueue(room.code, {
        videoId,
        title: cleanTitle,
        addedBy: nameOf(socket.id, room.code),
      });
      io.to(room.code).emit('room:state', updated);
      // if nothing is playing, auto-start the first added song
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
      io.to(room.code).emit('chat:message', {
        name: nameOf(socket.id, room.code),
        text: clean,
        ts: Date.now(),
      });
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
    close: () =>
      new Promise<void>((resolve) => {
        io.close();
        httpServer.close(() => resolve());
      }),
  };
}

// Start when run directly (not imported by a test).
if (process.argv[1] && process.argv[1].endsWith('index.ts')) {
  const port = Number(process.env.PORT ?? 3001);
  createServer(port);
  console.log(`Wavelength server listening on :${port}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace server`
Expected: all socket tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add Socket.IO server wiring with host-gated playback and chat"
```

---

### Task 4: Client scaffolding + typed socket singleton

**Files:**
- Create: `client/package.json`
- Create: `client/tsconfig.json`
- Create: `client/tsconfig.node.json`
- Create: `client/vite.config.ts`
- Create: `client/index.html`
- Create: `client/src/main.tsx`
- Create: `client/src/socket.ts`
- Create: `client/src/App.tsx`
- Create: `client/src/styles.css`

**Interfaces:**
- Consumes: `ClientToServerEvents`, `ServerToClientEvents` from `@wavelength/shared`.
- Produces: default-exported `socket` (typed `Socket<ServerToClientEvents, ClientToServerEvents>`), and `App` component that switches between Landing and Room.

- [ ] **Step 1: Create `client/package.json`**

```json
{
  "name": "@wavelength/client",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@wavelength/shared": "*",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "socket.io-client": "^4.7.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create `client/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `client/tsconfig.node.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "types": ["node"] },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: Create `client/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
```

- [ ] **Step 5: Create `client/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Wavelength — listen together</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `client/src/socket.ts`**

```ts
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@wavelength/shared';

const URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(URL, {
  transports: ['websocket'],
  autoConnect: true,
});

export default socket;
```

- [ ] **Step 7: Create `client/src/main.tsx`**

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 8: Create `client/src/App.tsx`** (placeholder that Task 5/6 fill in)

```tsx
import { useState } from 'react';
import type { RoomState } from '@wavelength/shared';

export default function App() {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [selfId, setSelfId] = useState<string>('');

  if (!room) {
    return <div className="app"><h1>Wavelength</h1><p>Get on the same wavelength.</p></div>;
  }
  return <div className="app"><h1>Room {room.code}</h1><p>Joined as {selfId}</p></div>;
}
```

- [ ] **Step 9: Create `client/src/styles.css`**

```css
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: system-ui, sans-serif;
  background: #0f1020;
  color: #e8e8f0;
}
.app { max-width: 1100px; margin: 0 auto; padding: 24px; }
button { cursor: pointer; border-radius: 8px; border: 1px solid #3a3a5a; background: #23234a; color: #e8e8f0; padding: 8px 14px; }
button:hover { background: #2e2e5e; }
input { border-radius: 8px; border: 1px solid #3a3a5a; background: #16162e; color: #e8e8f0; padding: 8px 10px; }
```

- [ ] **Step 10: Verify it builds and runs**

Run:
```bash
npm install
npm run typecheck --workspace client
npm run build --workspace client
```
Expected: typecheck clean, build succeeds.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "Scaffold React client with typed socket singleton"
```

---

### Task 5: Landing page (create / join room)

**Files:**
- Create: `client/src/Landing.tsx`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `socket` from `./socket.js`; `CreateJoinResult`, `RoomState` from `@wavelength/shared`.
- Produces: `Landing` component with prop `onJoined(state: RoomState, selfId: string): void`.

- [ ] **Step 1: Create `client/src/Landing.tsx`**

```tsx
import { useState } from 'react';
import type { CreateJoinResult, RoomState } from '@wavelength/shared';
import socket from './socket.js';

export default function Landing({ onJoined }: { onJoined: (s: RoomState, selfId: string) => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function handle(res: CreateJoinResult) {
    setBusy(false);
    if (res.ok) onJoined(res.state, res.selfId);
    else setError(res.error);
  }

  function create() {
    if (!name.trim()) return setError('Enter a name first.');
    setBusy(true); setError('');
    socket.emit('room:create', { name: name.trim() }, handle);
  }

  function join() {
    if (!name.trim()) return setError('Enter a name first.');
    if (!code.trim()) return setError('Enter a room code.');
    setBusy(true); setError('');
    socket.emit('room:join', { code: code.trim(), name: name.trim() }, handle);
  }

  return (
    <div className="landing">
      <h1>Wavelength</h1>
      <p className="tagline">Get on the same wavelength.</p>
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
      {error && <p className="error">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Update `client/src/App.tsx` to use Landing**

```tsx
import { useState } from 'react';
import type { RoomState } from '@wavelength/shared';
import Landing from './Landing.js';

export default function App() {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [selfId, setSelfId] = useState<string>('');

  if (!room) {
    return (
      <div className="app">
        <Landing onJoined={(s, id) => { setRoom(s); setSelfId(id); }} />
      </div>
    );
  }
  return (
    <div className="app">
      <h1>Room {room.code}</h1>
      <p>Joined as {selfId}. Host: {room.hostId === selfId ? 'you' : room.hostId}</p>
    </div>
  );
}
```

- [ ] **Step 3: Add landing styles to `client/src/styles.css`**

```css
.landing { max-width: 420px; margin: 10vh auto; text-align: center; }
.tagline { color: #9a9ac0; margin-top: -8px; }
.landing label { display: block; text-align: left; margin: 16px 0; }
.landing input { width: 100%; }
.actions { margin: 16px 0; }
.join-row { display: flex; gap: 8px; margin-top: 12px; }
.join-row input { flex: 1; text-transform: uppercase; }
.error { color: #ff8080; }
```

- [ ] **Step 4: Manually verify**

Run server (`npm run dev:server`) and client (`npm run dev:client`) in two terminals. In the browser: enter a name, click "Create a room", confirm the app switches to the room view showing a code. Open a second tab, enter that code + a different name, click Join — confirm it enters the room.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add landing page for creating and joining rooms"
```

---

### Task 6: YouTube player wrapper

**Files:**
- Create: `client/src/YouTubePlayer.tsx`
- Create: `client/src/youtubeApi.ts`

**Interfaces:**
- Produces:
  - `youtubeApi.ts`: `loadYouTubeApi(): Promise<typeof YT>` (loads the IFrame API script once, resolves when ready).
  - `YouTubePlayer.tsx`: `YouTubePlayer` component with props:
    - `videoId: string | null`
    - `onReady(player: YTPlayerHandle): void`
    - `onEnded(): void`
    - `onStateChange(isPlaying: boolean, positionSec: number): void`
  - Exported type `YTPlayerHandle = { play(): void; pause(): void; seekTo(sec: number): void; getCurrentTime(): number; loadVideo(id: string): void; }`

- [ ] **Step 1: Create `client/src/youtubeApi.ts`**

```ts
// Minimal loader for the YouTube IFrame Player API.
declare global {
  interface Window {
    YT?: typeof YT;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ready: Promise<typeof YT> | null = null;

export function loadYouTubeApi(): Promise<typeof YT> {
  if (ready) return ready;
  ready = new Promise((resolve) => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT!);
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  });
  return ready;
}
```

- [ ] **Step 2: Add YouTube types dependency**

Add `"@types/youtube": "^0.1.0"` to `client/package.json` devDependencies, and add `"youtube"` to `client/tsconfig.json` `compilerOptions.types` (so it reads `["vite/client", "youtube"]`). Run `npm install`.

- [ ] **Step 3: Create `client/src/YouTubePlayer.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import { loadYouTubeApi } from './youtubeApi.js';

export type YTPlayerHandle = {
  play(): void;
  pause(): void;
  seekTo(sec: number): void;
  getCurrentTime(): number;
  loadVideo(id: string): void;
};

type Props = {
  videoId: string | null;
  onReady: (h: YTPlayerHandle) => void;
  onEnded: () => void;
  onStateChange: (isPlaying: boolean, positionSec: number) => void;
};

export default function YouTubePlayer({ videoId, onReady, onEnded, onStateChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YT.Player | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadYouTubeApi().then((YT) => {
      if (cancelled || !hostRef.current) return;
      playerRef.current = new YT.Player(hostRef.current, {
        height: '390',
        width: '100%',
        videoId: videoId ?? undefined,
        playerVars: { autoplay: 0, controls: 1, rel: 0 },
        events: {
          onReady: () => {
            const p = playerRef.current!;
            onReady({
              play: () => p.playVideo(),
              pause: () => p.pauseVideo(),
              seekTo: (sec) => p.seekTo(sec, true),
              getCurrentTime: () => p.getCurrentTime(),
              loadVideo: (id) => p.loadVideoById(id),
            });
          },
          onStateChange: (e) => {
            const p = playerRef.current!;
            if (e.data === YT.PlayerState.ENDED) onEnded();
            if (e.data === YT.PlayerState.PLAYING) onStateChange(true, p.getCurrentTime());
            if (e.data === YT.PlayerState.PAUSED) onStateChange(false, p.getCurrentTime());
          },
        },
      });
    });
    return () => { cancelled = true; playerRef.current?.destroy(); playerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="player"><div ref={hostRef} /></div>;
}
```

- [ ] **Step 4: Verify it typechecks**

Run: `npm run typecheck --workspace client`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add YouTube IFrame player wrapper"
```

---

### Task 7: Room view — sync, controls, queue, chat, members

**Files:**
- Create: `client/src/useClockOffset.ts`
- Create: `client/src/Room.tsx`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `socket`, `YouTubePlayer` + `YTPlayerHandle`, `effectivePosition`, `isDrifted`, `estimateOffset`, `isValidVideoId`, all shared types.
- Produces: `useClockOffset(): number` hook (server-minus-client ms), and `Room` component with props `{ initialState: RoomState; selfId: string }`.

- [ ] **Step 1: Create `client/src/useClockOffset.ts`**

```ts
import { useEffect, useState } from 'react';
import { estimateOffset } from '@wavelength/shared';
import socket from './socket.js';

/** Returns estimated (serverClock - localClock) in ms, refined over a few samples. */
export function useClockOffset(): number {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    let best = { rtt: Infinity, offset: 0 };
    let stop = false;
    function sample(n: number) {
      if (stop || n <= 0) { setOffset(best.offset); return; }
      const t0 = Date.now();
      socket.emit('time:ping', { t0 }, ({ serverTime }) => {
        const t1 = Date.now();
        const rtt = t1 - t0;
        if (rtt < best.rtt) best = { rtt, offset: estimateOffset(t0, t1, serverTime) };
        setOffset(best.offset);
        sample(n - 1);
      });
    }
    sample(5);
    return () => { stop = true; };
  }, []);
  return offset;
}
```

- [ ] **Step 2: Create `client/src/Room.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import type { RoomState, PlaybackState, ChatMessage } from '@wavelength/shared';
import { effectivePosition, isDrifted, isValidVideoId } from '@wavelength/shared';
import socket from './socket.js';
import YouTubePlayer, { type YTPlayerHandle } from './YouTubePlayer.js';
import { useClockOffset } from './useClockOffset.js';

export default function Room({ initialState, selfId }: { initialState: RoomState; selfId: string }) {
  const [state, setState] = useState<RoomState>(initialState);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const playerRef = useRef<YTPlayerHandle | null>(null);
  const playbackRef = useRef<PlaybackState>(initialState.playback);
  const offset = useClockOffset();
  const offsetRef = useRef(0);
  offsetRef.current = offset;

  const isHost = state.hostId === selfId;

  // Apply server playback state to the local player.
  function applyPlayback(pb: PlaybackState) {
    playbackRef.current = pb;
    const player = playerRef.current;
    if (!player || !pb.videoId) return;
    const serverNow = Date.now() + offsetRef.current;
    const target = effectivePosition(pb, serverNow);
    if (isDrifted(player.getCurrentTime(), target)) player.seekTo(target);
    if (pb.isPlaying) player.play(); else player.pause();
  }

  useEffect(() => {
    socket.on('room:state', setState);
    socket.on('playback:update', applyPlayback);
    socket.on('chat:message', (m) => setMessages((prev) => [...prev, m].slice(-200)));
    return () => {
      socket.off('room:state', setState);
      socket.off('playback:update', applyPlayback);
      socket.off('chat:message');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Host heartbeat: re-stamp position every 4s so late/ drifting clients converge.
  useEffect(() => {
    if (!isHost) return;
    const id = setInterval(() => {
      const p = playerRef.current;
      if (p && playbackRef.current.isPlaying) {
        socket.emit('playback:heartbeat', { positionSec: p.getCurrentTime() });
      }
    }, 4000);
    return () => clearInterval(id);
  }, [isHost]);

  function onPlayerReady(h: YTPlayerHandle) {
    playerRef.current = h;
    applyPlayback(playbackRef.current);
  }

  // Host-only handlers
  function hostPlay() { socket.emit('playback:play', { positionSec: playerRef.current?.getCurrentTime() ?? 0 }); }
  function hostPause() { socket.emit('playback:pause', { positionSec: playerRef.current?.getCurrentTime() ?? 0 }); }
  function hostNext() { socket.emit('queue:next'); }

  function addSong() {
    const id = parseVideoId(urlInput.trim());
    if (!isValidVideoId(id)) { setUrlInput(''); return; }
    socket.emit('queue:add', { videoId: id, title: id });
    setUrlInput('');
  }

  function sendChat() {
    const t = chatText.trim();
    if (!t) return;
    socket.emit('chat:send', { text: t });
    setChatText('');
  }

  return (
    <div className="room">
      <header className="room-head">
        <h1>Wavelength</h1>
        <span className="code">Room <b>{state.code}</b></span>
        <span className="role">{isHost ? 'You are the host (DJ)' : 'Listening'}</span>
      </header>

      <div className="room-grid">
        <section className="stage">
          <YouTubePlayer
            videoId={state.playback.videoId}
            onReady={onPlayerReady}
            onEnded={() => { if (isHost) hostNext(); }}
            onStateChange={() => { /* server is source of truth; ignore local */ }}
          />
          {isHost && (
            <div className="controls">
              <button onClick={hostPlay}>Play</button>
              <button onClick={hostPause}>Pause</button>
              <button onClick={hostNext}>Skip ▶▶</button>
            </div>
          )}
          <div className="add-song">
            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Paste a YouTube link or 11-char id"
            />
            <button onClick={addSong}>Add to queue</button>
          </div>
        </section>

        <aside className="side">
          <div className="panel">
            <h3>Members ({state.members.length})</h3>
            <ul>{state.members.map((m) => (
              <li key={m.id}>{m.name}{m.id === state.hostId ? ' 🎧' : ''}{m.id === selfId ? ' (you)' : ''}</li>
            ))}</ul>
          </div>

          <div className="panel">
            <h3>Up next ({state.queue.length})</h3>
            <ol>{state.queue.map((q, i) => <li key={i}>{q.title} <small>— {q.addedBy}</small></li>)}</ol>
          </div>

          <div className="panel chat">
            <h3>Chat</h3>
            <div className="messages">
              {messages.map((m, i) => <div key={i}><b>{m.name}:</b> {m.text}</div>)}
            </div>
            <div className="chat-input">
              <input
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') sendChat(); }}
                placeholder="Say something…"
              />
              <button onClick={sendChat}>Send</button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Accepts a full YouTube URL or a bare id and returns the 11-char id (or ''). */
export function parseVideoId(input: string): string {
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;
  const patterns = [/[?&]v=([A-Za-z0-9_-]{11})/, /youtu\.be\/([A-Za-z0-9_-]{11})/, /embed\/([A-Za-z0-9_-]{11})/];
  for (const p of patterns) {
    const m = input.match(p);
    if (m) return m[1];
  }
  return '';
}
```

- [ ] **Step 3: Wire `Room` into `client/src/App.tsx`**

```tsx
import { useState } from 'react';
import type { RoomState } from '@wavelength/shared';
import Landing from './Landing.js';
import Room from './Room.js';

export default function App() {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [selfId, setSelfId] = useState<string>('');

  return (
    <div className="app">
      {room
        ? <Room initialState={room} selfId={selfId} />
        : <Landing onJoined={(s, id) => { setRoom(s); setSelfId(id); }} />}
    </div>
  );
}
```

- [ ] **Step 4: Add room styles to `client/src/styles.css`**

```css
.room-head { display: flex; align-items: baseline; gap: 16px; }
.room-head .code { color: #9a9ac0; }
.room-head .role { margin-left: auto; color: #7ad; }
.room-grid { display: grid; grid-template-columns: 1fr 320px; gap: 20px; margin-top: 16px; }
@media (max-width: 800px) { .room-grid { grid-template-columns: 1fr; } }
.controls { display: flex; gap: 8px; margin: 12px 0; }
.add-song { display: flex; gap: 8px; }
.add-song input { flex: 1; }
.panel { background: #16162e; border: 1px solid #2a2a4a; border-radius: 10px; padding: 12px; margin-bottom: 14px; }
.panel h3 { margin: 0 0 8px; font-size: 14px; color: #b8b8e0; }
.panel ul, .panel ol { margin: 0; padding-left: 18px; }
.chat .messages { height: 220px; overflow-y: auto; font-size: 14px; display: flex; flex-direction: column; gap: 4px; }
.chat-input { display: flex; gap: 6px; margin-top: 8px; }
.chat-input input { flex: 1; }
```

- [ ] **Step 5: Add a Vitest unit test for `parseVideoId`**

Create `client/src/parseVideoId.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseVideoId } from './Room.js';

describe('parseVideoId', () => {
  it('passes a bare id through', () => {
    expect(parseVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('extracts from a watch url', () => {
    expect(parseVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1')).toBe('dQw4w9WgXcQ');
  });
  it('extracts from a youtu.be url', () => {
    expect(parseVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('returns empty for garbage', () => {
    expect(parseVideoId('not a link')).toBe('');
  });
});
```

Add to `client/package.json` devDependencies: `"vitest": "^2.0.0"`, and a script `"test": "vitest run"`. Run `npm install`.

- [ ] **Step 6: Run the client test**

Run: `npm run test --workspace client`
Expected: parseVideoId tests PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add room view with synced playback, shared queue, and chat"
```

---

### Task 8: End-to-end verification + README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

````markdown
# Wavelength

*Get on the same wavelength.* Listen to the same YouTube song, in sync, with friends — plus a shared queue and live chat. No accounts, no database; rooms are ephemeral.

## Run locally

Requires Node 20+.

```bash
npm install
npm run dev:server   # terminal 1 — http://localhost:3001
npm run dev:client   # terminal 2 — http://localhost:5173
```

Open two browser tabs on http://localhost:5173. In tab 1 enter a name and create a room; copy the code. In tab 2 enter the code and a different name to join. The room creator is the host (DJ): only they can play/pause/skip, but anyone can add to the queue and chat.

## Tests

```bash
npm test
```

## Layout

- `shared/` — TypeScript event types + pure sync math (shared by client and server)
- `server/` — Express + Socket.IO; `RoomManager` holds room state in memory
- `client/` — React + Vite; YouTube IFrame player + room UI
````

- [ ] **Step 2: Full end-to-end manual test**

1. `npm install` then start both dev servers.
2. Tab 1: create a room as "Alice". Tab 2: join with the code as "Bob".
3. In either tab, paste a YouTube link and click "Add to queue" — confirm playback auto-starts in both tabs at the same position.
4. As Alice (host), click Pause — confirm Bob's player pauses too. Click Play — both resume together.
5. As Bob, add a second song; as Alice click Skip — confirm both advance to the next song.
6. Send chat from each tab — confirm both see messages.
7. Close Alice's tab — confirm Bob is promoted to host (host controls appear).

- [ ] **Step 3: Run the whole test suite**

Run: `npm test`
Expected: shared, server, and client suites all PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Add README and finalize v1"
```

---

## Self-Review Notes

- **Spec coverage:** identity/name-only (Task 5), create/join by code (Tasks 3, 5), synced YouTube playback (Tasks 1, 3, 6, 7), host-DJ + shared queue (Tasks 2, 3, 7), chat (Tasks 3, 7), member list (Task 7), reconnect/host-promotion/validation edge cases (Tasks 2, 3). All spec sections map to tasks.
- **Types consistency:** event names and payloads are defined once in `shared/src/events.ts` and consumed unchanged by server and client; `YTPlayerHandle`, `RoomState`, `PlaybackState` signatures are stable across tasks.
- **Placeholder scan:** no TBD/TODO; every code step contains full code.
- **Note on reconnect:** Socket.IO auto-reconnect is enabled by default in the client singleton; on a fresh page load the user re-lands and rejoins. Deeper "resume same identity across reconnect" is deferred (spec lists it under reconnect handling; v1 re-requests state via `room:state` broadcasts, which the client already subscribes to).
