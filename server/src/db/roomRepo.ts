import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';

export interface SavedRoom {
  id: string;
  ownerUserId: string;
  code: string;
  name: string;
  createdAt: number;
}

interface RoomRow {
  id: string;
  owner_user_id: string;
  code: string;
  name: string;
  created_at: number;
}

function toRoom(row: RoomRow): SavedRoom {
  return { id: row.id, ownerUserId: row.owner_user_id, code: row.code, name: row.name, createdAt: row.created_at };
}

export function createRoomRepo(db: DB) {
  const insert = db.prepare('INSERT INTO saved_rooms (id, owner_user_id, code, name, created_at) VALUES (?, ?, ?, ?, ?)');
  const byOwner = db.prepare('SELECT * FROM saved_rooms WHERE owner_user_id = ? ORDER BY created_at DESC');
  const byCode = db.prepare('SELECT * FROM saved_rooms WHERE code = ?');
  const del = db.prepare('DELETE FROM saved_rooms WHERE code = ? AND owner_user_id = ?');

  return {
    create(ownerUserId: string, code: string, name: string): SavedRoom {
      const id = randomUUID();
      const createdAt = Date.now();
      insert.run(id, ownerUserId, code, name, createdAt);
      return { id, ownerUserId, code, name, createdAt };
    },
    listByOwner(ownerUserId: string): SavedRoom[] {
      return (byOwner.all(ownerUserId) as RoomRow[]).map(toRoom);
    },
    findByCode(code: string): SavedRoom | null {
      const row = byCode.get(code) as RoomRow | undefined;
      return row ? toRoom(row) : null;
    },
    deleteByCode(code: string, ownerUserId: string): boolean {
      return del.run(code, ownerUserId).changes > 0;
    },
  };
}
