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
    /**
     * Distinct tracks, most recently played first. Every play is stored (so the
     * data is there for stats later), but a list that repeats the same title
     * once per replay is useless to read — so collapse by track and keep each
     * one's latest play time.
     */
    async listByUser(userId: string, limit = 200): Promise<HistoryEntry[]> {
      const rs = await db.execute({
        // MAX(rowid) breaks ties when two plays share a millisecond, so the
        // most recently inserted play always sorts first.
        sql: `SELECT video_id, title, MAX(played_at) AS played_at, MAX(rowid) AS last_row
              FROM history WHERE user_id = ?
              GROUP BY video_id
              ORDER BY played_at DESC, last_row DESC
              LIMIT ?`,
        args: [userId, limit],
      });
      return (rs.rows as unknown as HistoryRow[]).map((r) => ({ videoId: r.video_id, title: r.title, playedAt: r.played_at }));
    },
  };
}
