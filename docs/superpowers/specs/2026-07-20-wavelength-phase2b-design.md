# Wavelength Phase 2b — Design Spec

**Feature:** Mutual friends, real-time presence, one-click join, and direct room invites.

**Date:** 2026-07-20
**Status:** Draft for review

## Summary

Phase 2b adds a social layer on top of the Phase 2a account system: unique
handles, mutual friendships (request/accept), real-time presence showing which
friends are online and what room they are in, one-click join into a friend's
room, and host-initiated direct invites. Guests and logged-out users are
unaffected; all social features require an account with a handle.

## Scope

### In scope
- Unique `@username` handles on accounts (gated one-time pick for existing users).
- Mutual friendships: send request by handle, accept/decline, list friends, unfriend.
- Real-time presence: friends' online/offline state and current room code.
- One-click join into a friend's current room.
- Direct room invites: host invites an online friend, who gets a real-time
  notification with a Join action.
- Real-time notifications for incoming friend requests and invites.

### Out of scope (later phases)
- Blocking / muting users; privacy controls beyond friends-only visibility.
- Following (one-way) relationships.
- Group DMs or friend chat outside rooms.
- Push notifications when the app/tab is closed (presence is live-socket only).
- Spotify / local-file sources.

## Handles

- New column `users.username` (unique, case-insensitive). Format
  `^[a-z0-9_]{3,20}$`, stored lowercased.
- Existing Phase 2a users have no handle; social endpoints return `409` with a
  `NEEDS_HANDLE` marker until one is set. The client shows a "choose your handle"
  prompt.
- `PUT /api/account/username { username }` (auth): validate + set; `409` on
  taken/format errors. `GET /api/auth/me` now includes `username: string | null`.

## Friendship model

Single table `friend_edges`:

```sql
CREATE TABLE IF NOT EXISTS friend_edges (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL,
  addressee_id TEXT NOT NULL,
  status TEXT NOT NULL,          -- 'pending' | 'accepted'
  created_at INTEGER NOT NULL,
  UNIQUE (requester_id, addressee_id),
  FOREIGN KEY (requester_id) REFERENCES users(id),
  FOREIGN KEY (addressee_id) REFERENCES users(id)
);
```

- A `pending` row is a request from requester → addressee. `accepted` = friends.
- Declining deletes the row; unfriending deletes the accepted row.
- Sending a request first checks there is no existing edge in **either**
  direction (prevents duplicates and reverse-request races). Self-requests are
  rejected.
- Friends of X = rows where (`requester_id = X` OR `addressee_id = X`) AND
  `status = 'accepted'`.
- Incoming pending = `addressee_id = X AND status = 'pending'`.
- Outgoing pending = `requester_id = X AND status = 'pending'`.

### REST endpoints (all auth-required)
- `GET /api/friends` → `{ friends: [{ userId, username, displayName }] }`
- `GET /api/friends/requests` → `{ incoming: [...], outgoing: [...] }` (each with
  request id, other user's userId/username/displayName)
- `POST /api/friends/requests { username }` → send by handle; `404` unknown
  handle, `409` if already friends/pending, `400` self-request.
- `POST /api/friends/requests/:id/accept` → addressee-only; creates friendship.
- `POST /api/friends/requests/:id/decline` → addressee-only; deletes row.
- `DELETE /api/friends/:userId` → removes an accepted friendship either side.

## Presence

- `PresenceRegistry` (pure, in-memory, unit-tested): maps
  `userId → { socketIds: Set<string>, roomCode: string | null }`.
  - `addSocket(userId, socketId)`, `removeSocket(userId, socketId): { nowOffline: boolean }`
  - `setRoom(userId, roomCode | null)`, `clearIfSocket(...)`
  - `isOnline(userId): boolean`, `getPresence(userId): { online, roomCode }`
- Online = at least one live socket. Current room is last-join-wins across a
  user's sockets (documented simplification; multi-tab in different rooms shows
  the most recent).
- On socket connect (authed): register; push `presence:update` for this user to
  each **online friend**; send this socket a `presence:snapshot` of its friends.
- On `room:create` / `room:join`: `setRoom`; push `presence:update` to online
  friends. On `disconnect` / leaving all rooms: update room / mark offline; push
  `presence:update`.
- Presence is only visible to accepted friends. Non-friends never receive a
  user's presence.

## One-click join

- `presence:update` / `presence:snapshot` carry each friend's `roomCode` (or
  null). The friends list renders a Join button when `roomCode` is set; clicking
  runs the normal `room:join { code, name }` flow (works for ephemeral and saved
  rooms alike).

## Direct invites

- Client (host) emits `invite:send { toUserId }`.
- Server validates: sender is authed, sender hosts a live room, and sender and
  target are accepted friends. If the target has any online socket, push
  `invite:receive { fromDisplayName, code, roomName }` (roomName is the saved
  room name if the code is a saved room, else null).
- Target sees a dismissible banner with a Join button running `room:join`.

## New realtime events (added to `shared/src/events.ts`)

```ts
// Client -> Server
'invite:send': (payload: { toUserId: string }) => void;

// Server -> Client
'presence:snapshot': (payload: { friends: PresenceInfo[] }) => void;
'presence:update': (payload: PresenceInfo) => void;
'friend:requestReceived': (payload: { fromUsername: string; fromDisplayName: string }) => void;
'invite:receive': (payload: { fromDisplayName: string; code: string; roomName: string | null }) => void;
```

with `interface PresenceInfo { userId: string; online: boolean; roomCode: string | null }`.

## Server structure

```
server/src/
  db/friendRepo.ts        // friend_edges access (prepared statements)
  db/userRepo.ts          // + setUsername, findByUsername, username in User
  presence/presenceRegistry.ts   // pure in-memory presence
  api/accountRoutes.ts    // PUT /api/account/username
  api/friendRoutes.ts     // /api/friends[...]
  index.ts                // wire routes + presence bookkeeping + invite handler
```

`index.ts` grows; each new concern lives in its own module so handlers stay
readable.

## Client

- `AuthUser` gains `username: string | null`. When null, social UI shows a
  "set your @handle" prompt (calls `PUT /api/account/username`, then refreshes).
- `FriendsPanel` (landing): add friend by handle; incoming/outgoing requests with
  accept/decline; friends list with presence dot, current room, and Join.
- `usePresence` hook: seeds from `presence:snapshot`, applies `presence:update`.
- Toasts/banners for `friend:requestReceived` and `invite:receive` (with Join).
- Room view: host can invite online friends (list → `invite:send`).

## Security & validation

- zod on `PUT /api/account/username`, `POST /api/friends/requests`, and the
  `invite:send` payload.
- Handle format enforced; uniqueness case-insensitive.
- Every friend/invite action re-checks the relationship server-side: cannot
  invite non-friends, cannot accept/decline a request you are not the addressee
  of, cannot unfriend a non-friend.
- Presence is friends-only; no enumeration of non-friends.
- All SQL via prepared statements with bound parameters.

## Testing strategy

- **Unit:** `PresenceRegistry` (add/remove sockets, offline transition, room set,
  multi-socket); handle validator; `friendRepo` (send/accept/decline/list/
  unfriend, duplicate + reverse-edge prevention, self-request rejection).
- **Integration (REST):** two users — set handles, send request, list requests,
  accept, list friends, unfriend; `NEEDS_HANDLE` gating.
- **Integration (socket):** friend B joins a room → friend A receives
  `presence:update` with the room code; invite send/receive between friends;
  a request sent while the addressee is online triggers `friend:requestReceived`.

## Migration / compatibility notes

- `friend_edges` and the `users.username` column are added via idempotent
  migrations (`CREATE TABLE IF NOT EXISTS`; `ALTER TABLE users ADD COLUMN
  username` guarded by a column-existence check).
- Phase 2a behavior is unchanged for users without a handle; the social UI is
  additive and gated.

## Open questions / future phases

- Blocking/muting, privacy controls, one-way follow, offline push — later phases.
