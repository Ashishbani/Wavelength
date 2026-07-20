# Deploying Wavelength

The app runs as a **single service**: the Node/Socket.IO server serves the
built React client, so one URL/port hosts everything.

## Required environment variables

| Var | Value | Notes |
|-----|-------|-------|
| `JWT_SECRET` | a long random string | **Required** — the server won't start without it. Generate one: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `COOKIE_SECURE` | `true` | Set on any HTTPS host so the login cookie gets the Secure flag. |
| `PORT` | (host-provided) | Most hosts set this automatically; the server reads it. |
| `DB_PATH` | e.g. `/data/wavelength.sqlite` | Put on a **persistent volume** to keep accounts/playlists/history across restarts. Without a volume the data is ephemeral (guest rooms still work fully). |

## Option 1 — Render (easiest, free tier)

1. Push is already done — the repo is `Ashishbani/Wavelength` on `main`.
2. Go to https://render.com and sign up / log in with GitHub.
3. **New +  →  Web Service** → connect the `Ashishbani/Wavelength` repo (authorize Render to read it).
4. Render detects the **Dockerfile** → Language = **Docker**. Pick the nearest region and the **Free** instance.
5. Under **Environment**, add:
   - `JWT_SECRET` = your generated secret
   - `COOKIE_SECURE` = `true`
6. **Create Web Service.** Render builds the image and deploys; you get a URL like `https://wavelength-xxxx.onrender.com`.
7. Share that URL. Both people open it → create/join a room → listen in sync.

**Free-tier caveats:** the service sleeps after ~15 min idle (first hit after that is a slow cold start, and in-memory rooms are lost on sleep — just start a fresh room), and there's **no persistent disk**, so accounts/playlists/history reset on each deploy/restart. Guest rooms work fully. For persistence, add a paid **Disk** mounted at `/data`.

## Option 2 — Railway or Fly.io (persistent data)

Both support a persistent **volume** on their free/low tiers:

- **Railway:** New Project → Deploy from GitHub repo → add a **Volume** mounted at `/data` → set `JWT_SECRET` and `COOKIE_SECURE=true`.
- **Fly.io:** `fly launch` (detects the Dockerfile) → `fly volumes create data --size 1` → mount at `/data` → `fly secrets set JWT_SECRET=… COOKIE_SECURE=true`.

## Local production preview

```bash
cp .env.example .env   # set a JWT_SECRET
JWT_SECRET=... COOKIE_SECURE=false npm run serve   # builds client + serves on :3001
```
