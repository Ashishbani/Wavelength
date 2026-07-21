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
  return {
    async create(ownerUserId: string, code: string, name: string): Promise<SavedRoom> {
      const id = randomUUID();
      const createdAt = Date.now();
      await db.execute({
        sql: 'INSERT INTO saved_rooms (id, owner_user_id, code, name, created_at) VALUES (?, ?, ?, ?, ?)',
        args: [id, ownerUserId, code, name, createdAt],
      });
      return { id, ownerUserId, code, name, createdAt };
    },
    async listByOwner(ownerUserId: string): Promise<SavedRoom[]> {
      const rs = await db.execute({ sql: 'SELECT * FROM saved_rooms WHERE owner_user_id = ? ORDER BY created_at DESC', args: [ownerUserId] });
      return (rs.rows as unknown as RoomRow[]).map(toRoom);
    },
    async findByCode(code: string): Promise<SavedRoom | null> {
      const rs = await db.execute({ sql: 'SELECT * FROM saved_rooms WHERE code = ?', args: [code] });
      const row = rs.rows[0] as unknown as RoomRow | undefined;
      return row ? toRoom(row) : null;
    },
    async deleteByCode(code: string, ownerUserId: string): Promise<boolean> {
      const rs = await db.execute({ sql: 'DELETE FROM saved_rooms WHERE code = ? AND owner_user_id = ?', args: [code, ownerUserId] });
      return rs.rowsAffected > 0;
    },
  };
}
