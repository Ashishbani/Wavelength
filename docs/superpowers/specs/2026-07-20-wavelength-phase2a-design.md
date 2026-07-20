# Wavelength Phase 2a — Design Spec

**Feature:** Persistent accounts, saved rooms, saved playlists, and listening history.

**Date:** 2026-07-20
**Status:** Draft for review

## Summary

Phase 2a adds an optional account layer to Wavelength without disturbing the
frictionless guest experience from v1. Anyone can still join a room with just a
display name. Logging in unlocks: persistent rooms you own (stable code + name
that survive restarts), saved playlists, and a personal listening history.

Friends / following and presence are explicitly **deferred to Phase 2b** — this
spec does not cover the social graph.

## Scope

### In scope
- Email + password accounts (register, login, logout, "who am I").
- Session via a signed JWT stored in an httpOnly cookie; Socket.IO identifies the
  user from the same cookie on its handshake.
- Guests remain fully supported (no account needed to create or join a room).
- Saved rooms: a logged-in user creates a persistent room (stable code + name)
  that survives restarts and can be reopened.
- Saved playlists: save the current room queue as a named playlist; load a
  playlist into a room.
- Listening history: per authenticated user, a log of songs played in rooms
  they were in; viewable later.
- SQLite persistence behind a clean data-access layer.

### Out of scope (Phase 2b or later)
- Friends / following / social graph / online presence / room invites.
- Password reset / email verification / OAuth / magic links.
- Spotify and local-file sources.
- Sharing playlists between users; collaborative playlist editing.

## Guest vs. account behavior

| Capability                      | Guest | Logged-in |
|---------------------------------|-------|-----------|
| Create ephemeral room           | yes   | yes       |
| Join a room by code             | yes   | yes       |
| Host controls + shared queue    | yes   | yes       |
| Chat                            | yes   | yes       |
| Create a **saved** (persistent) room | no | yes    |
| Save / load playlists           | no    | yes       |
| Listening history recorded      | no    | yes       |

An ephemeral (guest-created) room deletes when its last member leaves, exactly as
in v1. A saved room's **definition** persists in the DB even when no one is in it;
its live in-memory instance is torn down when empty and recreated on reopen.

## Tech stack additions

- **Server:** `better-sqlite3` (synchronous SQLite), `bcryptjs` (pure-JS password
  hashing), `jsonwebtoken`, `cookie-parser`, `zod` (input validation). Plus
  `@types/*` where needed.
- **Client:** no new runtime deps; a React `AuthContext` and auth/account UI.
- Existing stack unchanged: TypeScript everywhere, Express + Socket.IO, React +
  Vite, Vitest.

## Architecture

```
server/src/
  db/
    db.ts            // opens SQLite, runs idempotent migrations
    userRepo.ts      // users table access (prepared statements)
    roomRepo.ts      // saved_rooms table access
    playlistRepo.ts  // playlists + playlist_items access
    historyRepo.ts   // history table access
  auth/
    password.ts      // hash(password), verify(password, hash) via bcryptjs
    token.ts         // signToken(payload), verifyToken(cookie) via jsonwebtoken
    validators.ts    // zod schemas for auth + account request bodies
    rateLimit.ts     // tiny in-memory attempt limiter for auth routes
    routes.ts        // express router: /api/auth/{register,login,logout,me}
  api/
    playlistRoutes.ts // express router: /api/playlists (+ /api/playlists/:id)
    historyRoutes.ts  // express router: /api/history
  roomManager.ts     // (extended) createRoomWithCode + persistent flag
  index.ts           // (extended) wires cookies, CORS-with-credentials,
                     // socket auth, playlist/history hooks
```

The server is authoritative for playback (unchanged) and now also for identity
and persistence. All DB access is confined to `db/` repositories.

## Data model (SQLite)

All ids are UUID strings (`crypto.randomUUID()`); timestamps are epoch ms
integers. All writes use prepared statements with bound parameters.

```sql
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
```

## Auth flow

1. **Register** `POST /api/auth/register { email, password, displayName }`:
   validate with zod (email format, password >= 8 chars, displayName 1–40),
   reject duplicate email, hash password (bcryptjs cost 12), insert user, set
   JWT cookie, return `{ id, email, displayName }`.
2. **Login** `POST /api/auth/login { email, password }`: rate-limited; look up
   user, `verify` password, set JWT cookie, return the user; generic error
   ("Invalid email or password") on any failure — never reveal which field.
3. **Logout** `POST /api/auth/logout`: clear the cookie.
4. **Me** `GET /api/auth/me`: read cookie, verify token, return the current user
   or `{ user: null }`.

**Cookie:** name `wl_token`, `httpOnly: true`, `sameSite: 'lax'`,
`secure: process.env.NODE_ENV === 'production'`, `maxAge` 7 days. JWT signed with
`process.env.JWT_SECRET`. In production the server refuses to start if
`JWT_SECRET` is unset; in dev it falls back to a fixed dev secret with a warning.

**Socket auth:** on connection, the server parses the `wl_token` cookie from
`socket.handshake.headers.cookie`, verifies it, and stores `userId` (or null) on
the socket. Used to gate saved-room creation, playlist actions, and history
logging. Playback control gating (host-only) is unchanged.

## Saved rooms

- `POST /api/rooms { name }` (auth required): generate a unique code, insert a
  `saved_rooms` row owned by the user, return `{ code, name }`.
- `GET /api/rooms` (auth required): list the user's saved rooms.
- `DELETE /api/rooms/:code` (auth required, owner only): delete the saved room
  definition (does not affect a currently live session).
- **Reactivation:** when a socket emits `room:join` with a saved room's code and
  no live instance exists, the server seeds a live room via
  `RoomManager.createRoomWithCode(code, socketId, name)`. The person who opens it
  becomes the live host for that session (v1 host model unchanged). Ownership in
  the DB is separate from the transient live-host role.
- RoomManager change: add `createRoomWithCode(code, hostId, hostName): RoomState`
  (throws `'CODE_IN_USE'` if a live room with that code already exists). Ephemeral
  rooms still delete on empty; the DB definition of a saved room is untouched by
  RoomManager.

## Playlists

- `POST /api/playlists { name, items: [{ videoId, title }] }` (auth): validate,
  insert playlist + ordered items, return the playlist with items.
- `GET /api/playlists` (auth): list the user's playlists (with items).
- `DELETE /api/playlists/:id` (auth, owner only): delete playlist + its items.
- **Load into room:** host-only socket event `queue:loadPlaylist { playlistId }`.
  The server verifies the socket's `userId` owns the playlist, reads its items,
  appends them to the live room's queue, and broadcasts `room:state`.
- **Save current queue:** the client reads the current room queue from its state
  and calls `POST /api/playlists`. No new socket event needed for saving.

## Listening history

- When a track becomes the current song (via `advanceQueue` / auto-start), the
  server iterates the live room's members, and for each member whose socket has a
  `userId`, inserts a `history` row `(user_id, video_id, title, played_at)`.
- `GET /api/history` (auth): return the user's history, most recent first,
  capped at the latest 200 rows.
- Guests (no `userId`) generate no history.

## Client

- `AuthContext` provider: on mount calls `GET /api/auth/me` (with credentials);
  exposes `{ user, login, register, logout, refresh }`.
- Landing page: adds a Log in / Sign up panel. When logged in, shows the user's
  display name, a "Your saved rooms" list (open/create/delete), a "Playlists"
  list, and a "History" view. Guest create/join remains prominently available.
- Room view: when the logged-in user is the host, adds "Save queue as playlist"
  (prompts for a name, POSTs current queue) and "Load playlist" (choose one,
  emits `queue:loadPlaylist`).
- Socket client: set `withCredentials: true` so the auth cookie is sent on the
  handshake.
- Fetch calls use `credentials: 'include'`.

## Security requirements

- Passwords hashed with bcryptjs (cost 12); never stored or logged in plaintext.
- JWT secret from `JWT_SECRET` env; production refuses to start without it.
- Cookies: httpOnly, sameSite=lax, secure in production.
- CORS: restricted to the configured client origin (`CLIENT_ORIGIN`,
  default `http://localhost:5173`) with `credentials: true`. No wildcard origin
  once credentials are enabled.
- All REST bodies and the `queue:loadPlaylist` payload validated with zod.
- All SQL via prepared statements with bound parameters (no interpolation).
- Ownership checks on every playlist/room mutation (a user can only modify their
  own rows).
- In-memory rate limiter on `/api/auth/login` and `/api/auth/register`
  (e.g. 10 attempts / 15 min per IP) to blunt brute force.
- The auth surface is flagged for human security review before any public
  deployment.

## Testing strategy

- **Unit:** `password` hash/verify roundtrip; `token` sign/verify (incl. reject
  tampered/expired); zod validators (accept valid, reject invalid); each
  repository against an in-memory (`:memory:`) SQLite instance
  (create/read/update/delete, unique constraints, ownership).
- **Integration (REST):** register → me → logout → me; duplicate-email rejection;
  login with wrong password rejected generically; rate limiter trips after N
  attempts; playlist create/list/delete with ownership enforcement; history
  returns rows for the right user only.
- **Integration (socket):** authed socket carries userId; guest socket has null;
  `queue:loadPlaylist` appends items for the owner and is ignored for a
  non-owner / non-host; history rows written when a track starts for authed
  members only; saved-room reactivation reuses the stored code.

## Migration / compatibility notes

- v1 behavior is a strict subset: with no cookie and no DB writes triggered,
  the app behaves exactly as before. The SQLite file is created on first run.
- The `.gitignore` must exclude the SQLite database file(s) (e.g. `*.sqlite`,
  `*.sqlite-journal`).
- A `.env.example` documents `JWT_SECRET`, `CLIENT_ORIGIN`, and `PORT`.

## Open questions / future phases

- Phase 2b: friends / following, presence, room invites (its own spec).
- Later: password reset + email verification, OAuth, playlist sharing.
