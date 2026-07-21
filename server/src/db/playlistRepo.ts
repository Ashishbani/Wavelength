import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';

export interface PlaylistItem {
  videoId: string;
  title: string;
}

export interface Playlist {
  id: string;
  ownerUserId: string;
  name: string;
  createdAt: number;
  items: PlaylistItem[];
}

interface PlaylistRow { id: string; owner_user_id: string; name: string; created_at: number; }
interface ItemRow { video_id: string; title: string; }

export function createPlaylistRepo(db: DB) {
  async function loadItems(playlistId: string): Promise<PlaylistItem[]> {
    const rs = await db.execute({ sql: 'SELECT video_id, title FROM playlist_items WHERE playlist_id = ? ORDER BY position ASC', args: [playlistId] });
    return (rs.rows as unknown as ItemRow[]).map((r) => ({ videoId: r.video_id, title: r.title }));
  }
  async function hydrate(row: PlaylistRow): Promise<Playlist> {
    return { id: row.id, ownerUserId: row.owner_user_id, name: row.name, createdAt: row.created_at, items: await loadItems(row.id) };
  }

  return {
    async create(ownerUserId: string, name: string, items: PlaylistItem[]): Promise<Playlist> {
      const id = randomUUID();
      const createdAt = Date.now();
      // Insert the playlist and all its items atomically.
      await db.batch(
        [
          { sql: 'INSERT INTO playlists (id, owner_user_id, name, created_at) VALUES (?, ?, ?, ?)', args: [id, ownerUserId, name, createdAt] },
          ...items.map((it, i) => ({
            sql: 'INSERT INTO playlist_items (id, playlist_id, video_id, title, position) VALUES (?, ?, ?, ?, ?)',
            args: [randomUUID(), id, it.videoId, it.title, i],
          })),
        ],
        'write',
      );
      return { id, ownerUserId, name, createdAt, items };
    },
    async listByOwner(ownerUserId: string): Promise<Playlist[]> {
      const rs = await db.execute({ sql: 'SELECT * FROM playlists WHERE owner_user_id = ? ORDER BY created_at DESC', args: [ownerUserId] });
      return Promise.all((rs.rows as unknown as PlaylistRow[]).map(hydrate));
    },
    async findById(id: string): Promise<Playlist | null> {
      const rs = await db.execute({ sql: 'SELECT * FROM playlists WHERE id = ?', args: [id] });
      const row = rs.rows[0] as unknown as PlaylistRow | undefined;
      return row ? hydrate(row) : null;
    },
    async deleteById(id: string, ownerUserId: string): Promise<boolean> {
      const rs = await db.execute({ sql: 'SELECT owner_user_id FROM playlists WHERE id = ?', args: [id] });
      const owned = rs.rows[0] as unknown as { owner_user_id: string } | undefined;
      if (!owned || owned.owner_user_id !== ownerUserId) return false;
      const res = await db.batch(
        [
          { sql: 'DELETE FROM playlist_items WHERE playlist_id = ?', args: [id] },
          { sql: 'DELETE FROM playlists WHERE id = ? AND owner_user_id = ?', args: [id, ownerUserId] },
        ],
        'write',
      );
      return (res[1]?.rowsAffected ?? 0) > 0;
    },
  };
}
