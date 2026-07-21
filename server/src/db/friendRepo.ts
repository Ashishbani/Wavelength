import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';

export interface FriendSummary {
  userId: string;
  username: string | null;
  displayName: string;
}

export interface PendingRequest {
  id: string;
  userId: string;
  username: string | null;
  displayName: string;
}

interface EdgeRow { id: string; requester_id: string; addressee_id: string; status: string; }
interface JoinRow { id: string; user_id: string; username: string | null; display_name: string; }

const ACCEPTED_FOR = `
  SELECT u.id AS user_id, u.username AS username, u.display_name AS display_name
  FROM friend_edges e
  JOIN users u ON u.id = CASE WHEN e.requester_id = ? THEN e.addressee_id ELSE e.requester_id END
  WHERE e.status = 'accepted' AND (e.requester_id = ? OR e.addressee_id = ?)
  ORDER BY u.display_name COLLATE NOCASE ASC
`;

export function createFriendRepo(db: DB) {
  function toSummary(r: JoinRow): FriendSummary {
    return { userId: r.user_id, username: r.username ?? null, displayName: r.display_name };
  }
  function toPending(r: JoinRow): PendingRequest {
    return { id: r.id, userId: r.user_id, username: r.username ?? null, displayName: r.display_name };
  }

  return {
    async sendRequest(requesterId: string, addresseeId: string): Promise<void> {
      if (requesterId === addresseeId) throw new Error('SELF');
      const existing = await db.execute({
        sql: 'SELECT * FROM friend_edges WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)',
        args: [requesterId, addresseeId, addresseeId, requesterId],
      });
      if (existing.rows[0]) throw new Error('EDGE_EXISTS');
      await db.execute({
        sql: 'INSERT INTO friend_edges (id, requester_id, addressee_id, status, created_at) VALUES (?, ?, ?, ?, ?)',
        args: [randomUUID(), requesterId, addresseeId, 'pending', Date.now()],
      });
    },
    async accept(id: string, addresseeId: string): Promise<boolean> {
      const rs = await db.execute({ sql: "SELECT * FROM friend_edges WHERE id = ? AND status = 'pending'", args: [id] });
      const row = rs.rows[0] as unknown as EdgeRow | undefined;
      if (!row || row.addressee_id !== addresseeId) return false;
      await db.execute({ sql: "UPDATE friend_edges SET status = 'accepted' WHERE id = ?", args: [id] });
      return true;
    },
    async decline(id: string, addresseeId: string): Promise<boolean> {
      const rs = await db.execute({ sql: "SELECT * FROM friend_edges WHERE id = ? AND status = 'pending'", args: [id] });
      const row = rs.rows[0] as unknown as EdgeRow | undefined;
      if (!row || row.addressee_id !== addresseeId) return false;
      await db.execute({ sql: 'DELETE FROM friend_edges WHERE id = ?', args: [id] });
      return true;
    },
    async listFriends(userId: string): Promise<FriendSummary[]> {
      const rs = await db.execute({ sql: ACCEPTED_FOR, args: [userId, userId, userId] });
      return (rs.rows as unknown as JoinRow[]).map(toSummary);
    },
    async listIncoming(userId: string): Promise<PendingRequest[]> {
      const rs = await db.execute({
        sql: `SELECT e.id AS id, u.id AS user_id, u.username AS username, u.display_name AS display_name
              FROM friend_edges e JOIN users u ON u.id = e.requester_id
              WHERE e.addressee_id = ? AND e.status = 'pending'`,
        args: [userId],
      });
      return (rs.rows as unknown as JoinRow[]).map(toPending);
    },
    async listOutgoing(userId: string): Promise<PendingRequest[]> {
      const rs = await db.execute({
        sql: `SELECT e.id AS id, u.id AS user_id, u.username AS username, u.display_name AS display_name
              FROM friend_edges e JOIN users u ON u.id = e.addressee_id
              WHERE e.requester_id = ? AND e.status = 'pending'`,
        args: [userId],
      });
      return (rs.rows as unknown as JoinRow[]).map(toPending);
    },
    async areFriends(a: string, b: string): Promise<boolean> {
      const rs = await db.execute({
        sql: 'SELECT * FROM friend_edges WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)',
        args: [a, b, b, a],
      });
      const row = rs.rows[0] as unknown as EdgeRow | undefined;
      return !!row && row.status === 'accepted';
    },
    async unfriend(a: string, b: string): Promise<boolean> {
      const rs = await db.execute({
        sql: "DELETE FROM friend_edges WHERE status = 'accepted' AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))",
        args: [a, b, b, a],
      });
      return rs.rowsAffected > 0;
    },
    async friendIds(userId: string): Promise<string[]> {
      const rs = await db.execute({ sql: ACCEPTED_FOR, args: [userId, userId, userId] });
      return (rs.rows as unknown as JoinRow[]).map((r) => r.user_id);
    },
  };
}
