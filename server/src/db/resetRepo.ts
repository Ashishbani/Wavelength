import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';

export interface PasswordReset {
  id: string;
  userId: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
}

interface ResetRow { id: string; user_id: string; code_hash: string; expires_at: number; attempts: number; }

function toReset(r: ResetRow): PasswordReset {
  return { id: r.id, userId: r.user_id, codeHash: r.code_hash, expiresAt: r.expires_at, attempts: r.attempts };
}

export function createResetRepo(db: DB) {
  return {
    /** One active reset per user: creating a new one replaces any previous. */
    async create(userId: string, codeHash: string, expiresAt: number): Promise<PasswordReset> {
      const id = randomUUID();
      await db.batch(
        [
          { sql: 'DELETE FROM password_resets WHERE user_id = ?', args: [userId] },
          {
            sql: 'INSERT INTO password_resets (id, user_id, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, ?, 0, ?)',
            args: [id, userId, codeHash, expiresAt, Date.now()],
          },
        ],
        'write',
      );
      return { id, userId, codeHash, expiresAt, attempts: 0 };
    },

    async findActiveByUserId(userId: string, now = Date.now()): Promise<PasswordReset | null> {
      const rs = await db.execute({
        sql: 'SELECT * FROM password_resets WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1',
        args: [userId, now],
      });
      const row = rs.rows[0] as unknown as ResetRow | undefined;
      return row ? toReset(row) : null;
    },

    async incrementAttempts(id: string): Promise<number> {
      await db.execute({ sql: 'UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?', args: [id] });
      const rs = await db.execute({ sql: 'SELECT attempts FROM password_resets WHERE id = ?', args: [id] });
      return Number((rs.rows[0] as unknown as { attempts: number } | undefined)?.attempts ?? 0);
    },

    async deleteForUser(userId: string): Promise<void> {
      await db.execute({ sql: 'DELETE FROM password_resets WHERE user_id = ?', args: [userId] });
    },
  };
}
