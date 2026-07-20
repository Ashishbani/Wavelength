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
