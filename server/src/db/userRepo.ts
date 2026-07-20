import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';

export interface User {
  id: string;
  email: string;
  displayName: string;
  username: string | null;
  createdAt: number;
}

export interface UserWithHash extends User {
  passwordHash: string;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  username: string | null;
  created_at: number;
}

export function createUserRepo(db: DB) {
  const insert = db.prepare(
    'INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const byEmail = db.prepare('SELECT * FROM users WHERE email = ?');
  const byId = db.prepare('SELECT * FROM users WHERE id = ?');
  const byUsername = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE');
  const setName = db.prepare('UPDATE users SET username = ? WHERE id = ?');

  function toUser(row: UserRow): User {
    return { id: row.id, email: row.email, displayName: row.display_name, username: row.username ?? null, createdAt: row.created_at };
  }

  return {
    create(email: string, passwordHash: string, displayName: string): User {
      const id = randomUUID();
      const createdAt = Date.now();
      try {
        insert.run(id, email, passwordHash, displayName, createdAt);
      } catch (e) {
        if (String((e as Error).message).includes('UNIQUE')) throw new Error('EMAIL_TAKEN');
        throw e;
      }
      return { id, email, displayName, username: null, createdAt };
    },
    findByEmail(email: string): UserWithHash | null {
      const row = byEmail.get(email) as UserRow | undefined;
      if (!row) return null;
      return { ...toUser(row), passwordHash: row.password_hash };
    },
    findById(id: string): User | null {
      const row = byId.get(id) as UserRow | undefined;
      return row ? toUser(row) : null;
    },
    findByUsername(username: string): User | null {
      const row = byUsername.get(username.toLowerCase()) as UserRow | undefined;
      return row ? toUser(row) : null;
    },
    setUsername(userId: string, username: string): void {
      try {
        setName.run(username.toLowerCase(), userId);
      } catch (e) {
        if (String((e as Error).message).includes('UNIQUE')) throw new Error('USERNAME_TAKEN');
        throw e;
      }
    },
  };
}
