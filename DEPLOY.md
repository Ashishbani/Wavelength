# Deploying Wavelength

The app runs as a **single service**: the Node/Socket.IO server serves the built
React client, so one URL hosts everything. Persistence (accounts, playlists,
history) lives in a **hosted Turso database**, so the compute host can be a free,
disk-less tier and accounts still survive every redeploy — and are reachable from
any device.

## Required environment variables

| Var | Value | Notes |
|-----|-------|-------|
| `JWT_SECRET` | a long random string | **Required.** Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `COOKIE_SECURE` | `true` | Set on any HTTPS host so the login cookie gets the Secure flag. |
| `DATABASE_URL` | `libsql://<db>.turso.io` | Your Turso database URL (see step 1). |
| `DATABASE_AUTH_TOKEN` | Turso token | Auth token for the database. |
| `PORT` | (host-provided) | Most hosts set this automatically; the server reads it. |

Without `DATABASE_URL` the server falls back to a local SQLite file (fine for dev; ephemeral in the cloud). Guest rooms work regardless of the database.

## Step 1 — Create the free Turso database

```bash
# Install the Turso CLI and sign up (no credit card)
curl -sSfL https://get.tur.so/install.sh | bash
turso auth signup

# Create a database and grab its credentials
turso db create wavelength
turso db show wavelength --url          # -> DATABASE_URL (libsql://…)
turso db tokens create wavelength       # -> DATABASE_AUTH_TOKEN
```

Keep the URL and token for step 2. (The schema creates itself on first boot — no manual migration needed.)

## Step 2 — Deploy the app on Render (free, no card)

1. Go to https://render.com and sign up / log in **with GitHub**.
2. **New +  →  Web Service** → connect the `Ashishbani/Wavelength` repo.
3. Render detects the **Dockerfile** → Language = **Docker**. Pick the nearest region and the **Free** instance.
4. Under **Environment**, add: `JWT_SECRET`, `COOKIE_SECURE=true`, `DATABASE_URL`, `DATABASE_AUTH_TOKEN`.
5. **Create Web Service.** You get a URL like `https://wavelength-xxxx.onrender.com` — that's the link to share.

**Free-tier note:** the service sleeps after ~15 min idle (first hit after that is a slow cold start, and in-memory live rooms reset on sleep — just start a fresh room). Accounts/playlists/history are in Turso, so they are unaffected. Koyeb's free tier works the same way if you prefer it.

## Local development

```bash
cp .env.example .env      # set JWT_SECRET; leave DATABASE_URL empty to use a local file
npm run dev:server        # http://localhost:3001
npm run dev:client        # http://localhost:5173
```

To preview the single-origin production build locally:

```bash
JWT_SECRET=dev-secret COOKIE_SECURE=false npm run serve   # builds client + serves on :3001
```

To develop against your Turso database instead of a local file, set `DATABASE_URL` and `DATABASE_AUTH_TOKEN` in `.env`.
