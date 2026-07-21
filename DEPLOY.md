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

## Option 1 — Fly.io + persistent volume (accounts survive redeploys)

The repo ships a `fly.toml` (one machine + a `/data` volume). Steps:

```bash
# 1. Install flyctl and sign in (opens a browser)
curl -L https://fly.io/install.sh | sh
fly auth login          # or: fly auth signup

# 2. Create the app from the bundled fly.toml (pick a unique name)
cd /path/to/wavelength
fly launch --copy-config --no-deploy --name wavelength-<yourname> --region bom

# 3. Create the persistent volume the config expects (same name + region)
fly volumes create wl_data --size 1 --region bom

# 4. Set the required secret (generate a strong one)
fly secrets set JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")"

# 5. Deploy
fly deploy
```

After it deploys, `fly open` (or the printed `https://wavelength-<yourname>.fly.dev` URL) is your shareable link. `COOKIE_SECURE` and `DB_PATH` are already set in `fly.toml`; the volume keeps accounts/playlists/history across every redeploy.

Notes:
- `fly launch` may ask to tweak settings — keep the volume mount, `internal_port = 3001`, and the env block.
- The machine stops when idle (first visit after that is a short cold start; live rooms are in memory so start a fresh room). Accounts on the volume are unaffected.
- To keep it always-on instead, set `min_machines_running = 1` and `auto_stop_machines = "off"` in `fly.toml`.

## Option 2 — Render (easiest, but accounts reset on redeploy)

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

## Option 3 — Railway (persistent data, web UI)

New Project → Deploy from GitHub repo → add a **Volume** mounted at `/data` → set `JWT_SECRET` and `COOKIE_SECURE=true`. Persists accounts like Fly, via a point-and-click UI.

## Local production preview

```bash
cp .env.example .env   # set a JWT_SECRET
JWT_SECRET=... COOKIE_SECURE=false npm run serve   # builds client + serves on :3001
```
