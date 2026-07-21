import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';

export interface HistoryEntry {
  videoId: string;
  title: string;
  playedAt: number;
}

interface HistoryRow { video_id: string; title: string; played_at: number; }

export function createHistoryRepo(db: DB) {
  return {
    async add(userId: string, videoId: string, title: string): Promise<void> {
      await db.execute({
        sql: 'INSERT INTO history (id, user_id, video_id, title, played_at) VALUES (?, ?, ?, ?, ?)',
        args: [randomUUID(), userId, videoId, title, Date.now()],
      });
    },
    async listByUser(userId: string, limit = 200): Promise<HistoryEntry[]> {
      const rs = await db.execute({
        sql: 'SELECT video_id, title, played_at FROM history WHERE user_id = ? ORDER BY played_at DESC, rowid DESC LIMIT ?',
        args: [userId, limit],
      });
      return (rs.rows as unknown as HistoryRow[]).map((r) => ({ videoId: r.video_id, title: r.title, playedAt: r.played_at }));
    },
  };
}
