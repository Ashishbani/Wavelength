import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';

export interface HistoryEntry {
  videoId: string;
  title: string;
  playedAt: number;
}

interface HistoryRow { video_id: string; title: string; played_at: number; }

export function createHistoryRepo(db: DB) {
  const insert = db.prepare('INSERT INTO history (id, user_id, video_id, title, played_at) VALUES (?, ?, ?, ?, ?)');
  const byUser = db.prepare('SELECT video_id, title, played_at FROM history WHERE user_id = ? ORDER BY played_at DESC, rowid DESC LIMIT ?');

  return {
    add(userId: string, videoId: string, title: string): void {
      insert.run(randomUUID(), userId, videoId, title, Date.now());
    },
    listByUser(userId: string, limit = 200): HistoryEntry[] {
      return (byUser.all(userId, limit) as HistoryRow[]).map((r) => ({ videoId: r.video_id, title: r.title, playedAt: r.played_at }));
    },
  };
}
