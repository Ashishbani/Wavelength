import { createClient, type Client } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Client;

/**
 * Open a libSQL client.
 *  - Hosted (Turso): set DATABASE_URL (libsql://…) and DATABASE_AUTH_TOKEN.
 *  - Local dev: a file: URL (default `file:wavelength.sqlite`, or DB_PATH).
 *  - Tests: pass ':memory:'.
 */
/** True when persistence is a hosted database rather than a local file. */
export function isHostedDb(): boolean {
  return !!process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith('file:');
}

export function openDb(url?: string): DB {
  const resolved = url ?? process.env.DATABASE_URL ?? `file:${process.env.DB_PATH ?? 'wavelength.sqlite'}`;
  const authToken = process.env.DATABASE_AUTH_TOKEN;
  // Loud warning: on a host with no persistent disk, a file DB is wiped on every
  // restart/redeploy — accounts and uploads silently vanish.
  if (!url && process.env.NODE_ENV === 'production' && !isHostedDb()) {
    console.warn(
      '[wavelength] WARNING: DATABASE_URL is not set — using a LOCAL FILE database. ' +
      'On a host without a persistent disk, all accounts, playlists and uploaded ' +
      'music are LOST on every restart or redeploy. Set DATABASE_URL and ' +
      'DATABASE_AUTH_TOKEN (see DEPLOY.md) to persist data.',
    );
  }
  // For a local file DB, make sure the parent directory exists.
  if (resolved.startsWith('file:')) {
    const file = resolved.slice('file:'.length);
    if (file && file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  return createClient(authToken ? { url: resolved, authToken } : { url: resolved });
}

/** Create tables and indexes. Idempotent — safe to run on every startup. */
export async function migrate(db: DB): Promise<void> {
  await db.executeMultiple(`
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
    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (owner_user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS track_chunks (
      track_id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      data BLOB NOT NULL,
      PRIMARY KEY (track_id, idx),
      FOREIGN KEY (track_id) REFERENCES tracks(id)
    );
    CREATE TABLE IF NOT EXISTS favourites (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      title TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'yt',
      created_at INTEGER NOT NULL,
      UNIQUE (user_id, video_id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS friend_edges (
      id TEXT PRIMARY KEY,
      requester_id TEXT NOT NULL,
      addressee_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (requester_id, addressee_id),
      FOREIGN KEY (requester_id) REFERENCES users(id),
      FOREIGN KEY (addressee_id) REFERENCES users(id)
    );
  `);

  const cols = await db.execute('PRAGMA table_info(users)');
  if (!cols.rows.some((c) => (c as { name?: string }).name === 'username')) {
    await db.execute('ALTER TABLE users ADD COLUMN username TEXT');
  }
  await db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE)');
  // Per-user lookups are the only access pattern for these tables.
  await db.execute('CREATE INDEX IF NOT EXISTS idx_history_user ON history(user_id, played_at DESC)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_favourites_user ON favourites(user_id, created_at DESC)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_tracks_owner ON tracks(owner_user_id, created_at DESC)');
}
