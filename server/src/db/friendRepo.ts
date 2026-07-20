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

export function createFriendRepo(db: DB) {
  const anyEdge = db.prepare(
    'SELECT * FROM friend_edges WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)',
  );
  const insert = db.prepare('INSERT INTO friend_edges (id, requester_id, addressee_id, status, created_at) VALUES (?, ?, ?, ?, ?)');
  const pendingById = db.prepare("SELECT * FROM friend_edges WHERE id = ? AND status = 'pending'");
  const setAccepted = db.prepare("UPDATE friend_edges SET status = 'accepted' WHERE id = ?");
  const delById = db.prepare('DELETE FROM friend_edges WHERE id = ?');
  const delPair = db.prepare(
    "DELETE FROM friend_edges WHERE status = 'accepted' AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))",
  );
  const acceptedFor = db.prepare(`
    SELECT u.id AS user_id, u.username AS username, u.display_name AS display_name
    FROM friend_edges e
    JOIN users u ON u.id = CASE WHEN e.requester_id = ? THEN e.addressee_id ELSE e.requester_id END
    WHERE e.status = 'accepted' AND (e.requester_id = ? OR e.addressee_id = ?)
    ORDER BY u.display_name COLLATE NOCASE ASC
  `);
  const incoming = db.prepare(`
    SELECT e.id AS id, u.id AS user_id, u.username AS username, u.display_name AS display_name
    FROM friend_edges e JOIN users u ON u.id = e.requester_id
    WHERE e.addressee_id = ? AND e.status = 'pending'
  `);
  const outgoing = db.prepare(`
    SELECT e.id AS id, u.id AS user_id, u.username AS username, u.display_name AS display_name
    FROM friend_edges e JOIN users u ON u.id = e.addressee_id
    WHERE e.requester_id = ? AND e.status = 'pending'
  `);

  function toSummary(r: JoinRow): FriendSummary {
    return { userId: r.user_id, username: r.username ?? null, displayName: r.display_name };
  }
  function toPending(r: JoinRow): PendingRequest {
    return { id: r.id, userId: r.user_id, username: r.username ?? null, displayName: r.display_name };
  }

  return {
    sendRequest(requesterId: string, addresseeId: string): void {
      if (requesterId === addresseeId) throw new Error('SELF');
      const existing = anyEdge.get(requesterId, addresseeId, addresseeId, requesterId);
      if (existing) throw new Error('EDGE_EXISTS');
      insert.run(randomUUID(), requesterId, addresseeId, 'pending', Date.now());
    },
    accept(id: string, addresseeId: string): boolean {
      const row = pendingById.get(id) as EdgeRow | undefined;
      if (!row || row.addressee_id !== addresseeId) return false;
      setAccepted.run(id);
      return true;
    },
    decline(id: string, addresseeId: string): boolean {
      const row = pendingById.get(id) as EdgeRow | undefined;
      if (!row || row.addressee_id !== addresseeId) return false;
      delById.run(id);
      return true;
    },
    listFriends(userId: string): FriendSummary[] {
      return (acceptedFor.all(userId, userId, userId) as JoinRow[]).map(toSummary);
    },
    listIncoming(userId: string): PendingRequest[] {
      return (incoming.all(userId) as JoinRow[]).map(toPending);
    },
    listOutgoing(userId: string): PendingRequest[] {
      return (outgoing.all(userId) as JoinRow[]).map(toPending);
    },
    areFriends(a: string, b: string): boolean {
      const row = anyEdge.get(a, b, b, a) as EdgeRow | undefined;
      return !!row && row.status === 'accepted';
    },
    unfriend(a: string, b: string): boolean {
      return delPair.run(a, b, b, a).changes > 0;
    },
    friendIds(userId: string): string[] {
      return (acceptedFor.all(userId, userId, userId) as JoinRow[]).map((r) => r.user_id);
    },
  };
}
