# Wavelength — Design Spec

**Tagline:** *Get on the same wavelength.*

**Date:** 2026-07-20
**Status:** Draft for review

## Summary

Wavelength is a web app where friends join a room and listen to the same YouTube
song in perfect sync, with a shared queue anyone can contribute to and a live
text chat. There are no accounts and no database: a visitor enters a display
name, creates or joins a room by code, and starts listening together. Rooms are
ephemeral and live in server memory.

This spec covers **version 1 only**. Later phases (Spotify, local files,
persistent accounts, saved rooms) are explicitly out of scope here and will get
their own spec → plan → implementation cycles.

## Scope

### In scope (v1)
- Lightweight identity: enter a display name, no signup, no password.
- Create a room (get a shareable code) and join a room by code.
- Synced YouTube playback across all room members.
- Control model: **host is the DJ** (only host controls play/pause/seek and
  advances songs), but **anyone can add to the shared queue**.
- Real-time in-room text chat (ephemeral, not stored).
- Live member list.

### Out of scope (v1)
- Spotify and local-file sources (YouTube only for now).
- User accounts, profiles, persistence, listening history.
- Saved/named rooms surviving a restart.
- Mobile-native apps (responsive web is fine).

## Tech stack

- **Frontend:** React + Vite. Renders room UI and embeds the YouTube IFrame
  Player API. Single Socket.IO connection to the server.
- **Backend:** Node + Express + Socket.IO. Holds all room state in an in-memory
  `Map`. Source of truth for playback state; relays chat and queue events.
- **No database, no auth** — everything is ephemeral by design for v1.
- **Testing:** Vitest for server unit/integration tests.

## Architecture

```
wavelength/
  server/   Express + Socket.IO, room manager, sync logic
  client/   React + Vite, room UI, YouTube player wrapper
  docs/     this spec
```

The server is authoritative for playback state. Clients never trust each other's
clocks directly; they reconcile against the server via a clock-offset handshake.

## Data model (server-side, per room)

```
Room {
  code:          string           // short shareable code
  hostSocketId:  string           // current DJ
  members:       [{ id, name }]   // id = socket id
  queue:         [{ videoId, title, addedBy }]
  playback: {
    videoId:            string | null
    isPlaying:          boolean
    positionSec:        number    // playback position at lastUpdateServerTs
    lastUpdateServerTs: number    // server epoch ms when position was stamped
  }
}
```

Rooms are stored in `Map<code, Room>`. A room is deleted when its last member
leaves.

## Sync algorithm

1. **Clock offset handshake.** On connect, the client runs a tiny NTP-style
   ping/pong to estimate its clock offset versus the server:
   `offset = serverTime - (t0 + t1) / 2`. This lets the client translate server
   timestamps into its own clock.
2. **Host emits control events only.** Only the host emits `play`, `pause`,
   `seek`, and `changeVideo`. On each, the server stamps `positionSec` and
   `lastUpdateServerTs` and broadcasts the new playback state to the room.
3. **Everyone computes true position.** For any client (including a late
   joiner), the effective current position when playing is
   `positionSec + (serverNow - lastUpdateServerTs) / 1000`. The client seeks its
   YouTube player there and plays (or pauses at `positionSec` if paused).
4. **Drift correction.** The host broadcasts a lightweight heartbeat every few
   seconds carrying its current position. Any listener whose player has drifted
   more than ~1 second from the expected position quietly re-seeks. This keeps
   everyone locked together over long sessions.

The position math (steps 1 and 3) is implemented as pure functions so it can be
unit-tested in isolation.

## Shared queue

- Any member emits `addToQueue { videoId, title }`; the server appends and
  broadcasts the updated queue.
- When a song ends or the host skips, the server pops the next item, sets it as
  the current `videoId`, resets playback position to 0, and broadcasts a
  `changeVideo`.
- If the queue is empty when a song ends, playback stops and waits.

## Chat

- Any member emits `chat { text }`; the server broadcasts
  `chat { name, text, ts }` to the room. Messages are ephemeral (not stored).
- Basic guards: trim, length cap, drop empty messages.

## Error handling & edge cases

- **Reconnect:** Socket.IO auto-reconnects. On reconnect the client re-requests
  full room state and re-syncs playback.
- **Host leaves:** the server promotes the next member to host; if the room is
  now empty, it is deleted.
- **Invalid room code:** join is rejected with a clear error message.
- **Duplicate display name in a room:** rejected (or auto-suffixed) with a clear
  message.
- **Malformed events / oversized payloads:** validated and rejected server-side.

## Testing strategy

- **Unit tests (Vitest):** position/drift math (pure functions), room lifecycle
  (create/join/leave), queue advance, host promotion.
- **Integration tests:** a real Socket.IO client drives create → join → play →
  chat → leave flows against a test server instance.

## Open questions / future phases

- Phase 2 candidates: Spotify (Web Playback SDK, requires Premium), local-file
  upload/streaming, persistent accounts, saved rooms, reactions/emojis.
- These are intentionally deferred; v1 proves synced group listening end to end.
