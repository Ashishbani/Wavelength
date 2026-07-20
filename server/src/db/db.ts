import Database from 'better-sqlite3';

export type DB = Database.Database;

export function openDb(path = process.env.DB_PATH ?? 'wavelength.sqlite'): DB {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function migrate(db: DB): void {
  db.exec(`
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

  const cols = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'username')) {
    db.exec('ALTER TABLE users ADD COLUMN username TEXT');
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE)');
}
