import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';
import type { TrackKind } from '@wavelength/shared';

export interface Favourite {
  videoId: string;
  title: string;
  kind: TrackKind;
  createdAt: number;
}

interface FavRow { video_id: string; title: string; kind: string; created_at: number; }

function toFav(r: FavRow): Favourite {
  return { videoId: r.video_id, title: r.title, kind: r.kind === 'lib' ? 'lib' : 'yt', createdAt: r.created_at };
}

export function createFavouriteRepo(db: DB) {
  return {
    /** Idempotent: favouriting the same track twice keeps one row. */
    async add(userId: string, videoId: string, title: string, kind: TrackKind = 'yt'): Promise<void> {
      await db.execute({
        sql: `INSERT INTO favourites (id, user_id, video_id, title, kind, created_at)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT (user_id, video_id) DO UPDATE SET title = excluded.title`,
        args: [randomUUID(), userId, videoId, title, kind, Date.now()],
      });
    },
    async listByUser(userId: string, limit = 200): Promise<Favourite[]> {
      const rs = await db.execute({
        sql: 'SELECT video_id, title, kind, created_at FROM favourites WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
        args: [userId, limit],
      });
      return (rs.rows as unknown as FavRow[]).map(toFav);
    },
    async remove(userId: string, videoId: string): Promise<boolean> {
      const rs = await db.execute({
        sql: 'DELETE FROM favourites WHERE user_id = ? AND video_id = ?',
        args: [userId, videoId],
      });
      return rs.rowsAffected > 0;
    },
  };
}
