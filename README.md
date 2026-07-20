# Wavelength

*Get on the same wavelength.* Listen to the same YouTube song, in sync, with friends — plus a shared queue and live chat. Guests need no account; optional accounts add saved rooms, playlists, and listening history.

## Run locally

Requires Node 20+.

```bash
cp .env.example .env   # then edit values (see Configuration below)
npm install
npm run dev:server   # terminal 1 — http://localhost:3001
npm run dev:client   # terminal 2 — http://localhost:5173
```

Open two browser tabs on http://localhost:5173. In tab 1 enter a name and create a room; copy the code. In tab 2 enter the code and a different name to join. The room creator is the host (DJ): only they can play/pause/skip, but anyone can add to the queue and chat.

## Accounts (Phase 2a)

Accounts are optional — guests can still create/join rooms with just a name.
Signing up (email + password) unlocks:

- **Saved rooms** — a permanent room with a stable code you can reopen anytime.
- **Playlists** — save the current queue and load it into any room you host.
- **Listening history** — a personal log of what played in rooms you were in.

### Friends & presence (Phase 2b)

Set an `@handle`, then add friends by handle (they accept your request). You'll
see which friends are online and what room they're in, with one-click **Join**.
Hosts can also invite an online friend directly — they get a notification with a
Join button.

### Configuration

Copy `.env.example` to `.env` in the repo root and set values before running the server:

- `JWT_SECRET` — required in production; the server refuses to start without it.
- `CLIENT_ORIGIN` — the client URL allowed by CORS (default `http://localhost:5173`).
- `DB_PATH` — SQLite file path (default `wavelength.sqlite`).
- `PORT` — server port (default `3001`).

## Tests

```bash
npm test
```

## Layout

- `shared/` — TypeScript event types + pure sync math (shared by client and server)
- `server/` — Express + Socket.IO; `RoomManager` holds live room state in memory; `db/` (SQLite repos), `auth/` (password/JWT/validators), `api/` (REST routes)
- `client/` — React + Vite; YouTube IFrame player, room UI, and `auth/` (context + account UI)
