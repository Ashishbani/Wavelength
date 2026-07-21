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
  function toUser(row: UserRow): User {
    return { id: row.id, email: row.email, displayName: row.display_name, username: row.username ?? null, createdAt: row.created_at };
  }

  return {
    async create(email: string, passwordHash: string, displayName: string): Promise<User> {
      const id = randomUUID();
      const createdAt = Date.now();
      try {
        await db.execute({
          sql: 'INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)',
          args: [id, email, passwordHash, displayName, createdAt],
        });
      } catch (e) {
        if (String((e as Error).message).includes('UNIQUE')) throw new Error('EMAIL_TAKEN');
        throw e;
      }
      return { id, email, displayName, username: null, createdAt };
    },
    async findByEmail(email: string): Promise<UserWithHash | null> {
      const rs = await db.execute({ sql: 'SELECT * FROM users WHERE email = ?', args: [email] });
      const row = rs.rows[0] as unknown as UserRow | undefined;
      if (!row) return null;
      return { ...toUser(row), passwordHash: row.password_hash };
    },
    async findById(id: string): Promise<User | null> {
      const rs = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [id] });
      const row = rs.rows[0] as unknown as UserRow | undefined;
      return row ? toUser(row) : null;
    },
    async findByUsername(username: string): Promise<User | null> {
      const rs = await db.execute({ sql: 'SELECT * FROM users WHERE username = ? COLLATE NOCASE', args: [username.toLowerCase()] });
      const row = rs.rows[0] as unknown as UserRow | undefined;
      return row ? toUser(row) : null;
    },
    async setUsername(userId: string, username: string): Promise<void> {
      try {
        await db.execute({ sql: 'UPDATE users SET username = ? WHERE id = ?', args: [username.toLowerCase(), userId] });
      } catch (e) {
        if (String((e as Error).message).includes('UNIQUE')) throw new Error('USERNAME_TAKEN');
        throw e;
      }
    },
  };
}
