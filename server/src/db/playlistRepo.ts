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
  const insertPlaylist = db.prepare('INSERT INTO playlists (id, owner_user_id, name, created_at) VALUES (?, ?, ?, ?)');
  const insertItem = db.prepare('INSERT INTO playlist_items (id, playlist_id, video_id, title, position) VALUES (?, ?, ?, ?, ?)');
  const byOwner = db.prepare('SELECT * FROM playlists WHERE owner_user_id = ? ORDER BY created_at DESC');
  const byId = db.prepare('SELECT * FROM playlists WHERE id = ?');
  const itemsFor = db.prepare('SELECT video_id, title FROM playlist_items WHERE playlist_id = ? ORDER BY position ASC');
  const delItems = db.prepare('DELETE FROM playlist_items WHERE playlist_id = ?');
  const delPlaylist = db.prepare('DELETE FROM playlists WHERE id = ? AND owner_user_id = ?');

  function loadItems(playlistId: string): PlaylistItem[] {
    return (itemsFor.all(playlistId) as ItemRow[]).map((r) => ({ videoId: r.video_id, title: r.title }));
  }
  function hydrate(row: PlaylistRow): Playlist {
    return { id: row.id, ownerUserId: row.owner_user_id, name: row.name, createdAt: row.created_at, items: loadItems(row.id) };
  }

  const createTx = db.transaction((ownerUserId: string, name: string, items: PlaylistItem[]): Playlist => {
    const id = randomUUID();
    const createdAt = Date.now();
    insertPlaylist.run(id, ownerUserId, name, createdAt);
    items.forEach((it, i) => insertItem.run(randomUUID(), id, it.videoId, it.title, i));
    return { id, ownerUserId, name, createdAt, items };
  });

  const deleteTx = db.transaction((id: string, ownerUserId: string): boolean => {
    const owned = byId.get(id) as PlaylistRow | undefined;
    if (!owned || owned.owner_user_id !== ownerUserId) return false;
    delItems.run(id);
    return delPlaylist.run(id, ownerUserId).changes > 0;
  });

  return {
    create(ownerUserId: string, name: string, items: PlaylistItem[]): Playlist {
      return createTx(ownerUserId, name, items);
    },
    listByOwner(ownerUserId: string): Playlist[] {
      return (byOwner.all(ownerUserId) as PlaylistRow[]).map(hydrate);
    },
    findById(id: string): Playlist | null {
      const row = byId.get(id) as PlaylistRow | undefined;
      return row ? hydrate(row) : null;
    },
    deleteById(id: string, ownerUserId: string): boolean {
      return deleteTx(id, ownerUserId);
    },
  };
}
