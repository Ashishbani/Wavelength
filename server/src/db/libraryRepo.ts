import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';

export interface Track {
  id: string;
  ownerUserId: string;
  title: string;
  mime: string;
  size: number;
  createdAt: number;
}

interface TrackRow { id: string; owner_user_id: string; title: string; mime: string; size: number; created_at: number; }

function toTrack(r: TrackRow): Track {
  return { id: r.id, ownerUserId: r.owner_user_id, title: r.title, mime: r.mime, size: r.size, createdAt: r.created_at };
}

// Audio bytes are stored in fixed-size chunk rows so a track never exceeds a
// single statement/response size limit of the hosted database.
export const CHUNK_SIZE = 512 * 1024;

export function createLibraryRepo(db: DB) {
  return {
    async create(ownerUserId: string, title: string, mime: string, bytes: Buffer): Promise<Track> {
      const id = randomUUID();
      const createdAt = Date.now();
      await db.execute({
        sql: 'INSERT INTO tracks (id, owner_user_id, title, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        args: [id, ownerUserId, title, mime, bytes.length, createdAt],
      });
      try {
        // Group chunk inserts into batches (~2 MB per request): far fewer
        // network round-trips than one-per-chunk, while staying comfortably
        // under the hosted database's request-size limits.
        const CHUNKS_PER_BATCH = 4;
        const stmts = [];
        for (let i = 0, idx = 0; i < bytes.length; i += CHUNK_SIZE, idx++) {
          stmts.push({
            sql: 'INSERT INTO track_chunks (track_id, idx, data) VALUES (?, ?, ?)',
            args: [id, idx, bytes.subarray(i, i + CHUNK_SIZE)],
          });
        }
        for (let i = 0; i < stmts.length; i += CHUNKS_PER_BATCH) {
          await db.batch(stmts.slice(i, i + CHUNKS_PER_BATCH), 'write');
        }
      } catch (e) {
        // Never leave a half-written track behind — it would list but not play.
        await db.batch(
          [
            { sql: 'DELETE FROM track_chunks WHERE track_id = ?', args: [id] },
            { sql: 'DELETE FROM tracks WHERE id = ?', args: [id] },
          ],
          'write',
        ).catch(() => {});
        throw e;
      }
      return { id, ownerUserId, title, mime, size: bytes.length, createdAt };
    },

    async listByOwner(ownerUserId: string): Promise<Track[]> {
      const rs = await db.execute({
        sql: 'SELECT * FROM tracks WHERE owner_user_id = ? ORDER BY created_at DESC',
        args: [ownerUserId],
      });
      return (rs.rows as unknown as TrackRow[]).map(toTrack);
    },

    async findById(id: string): Promise<Track | null> {
      const rs = await db.execute({ sql: 'SELECT * FROM tracks WHERE id = ?', args: [id] });
      const row = rs.rows[0] as unknown as TrackRow | undefined;
      return row ? toTrack(row) : null;
    },

    /** Read [start, end] (inclusive) of a track's bytes by fetching only the chunks that overlap. */
    async readRange(id: string, start: number, end: number): Promise<Buffer> {
      const firstIdx = Math.floor(start / CHUNK_SIZE);
      const lastIdx = Math.floor(end / CHUNK_SIZE);
      const rs = await db.execute({
        sql: 'SELECT idx, data FROM track_chunks WHERE track_id = ? AND idx BETWEEN ? AND ? ORDER BY idx ASC',
        args: [id, firstIdx, lastIdx],
      });
      const parts = (rs.rows as unknown as { idx: number; data: ArrayBuffer | Uint8Array }[]).map((r) =>
        Buffer.from(r.data as ArrayBuffer),
      );
      const joined = Buffer.concat(parts);
      const offset = start - firstIdx * CHUNK_SIZE;
      return joined.subarray(offset, offset + (end - start + 1));
    },

    async deleteById(id: string, ownerUserId: string): Promise<boolean> {
      const rs = await db.execute({ sql: 'SELECT owner_user_id FROM tracks WHERE id = ?', args: [id] });
      const owned = rs.rows[0] as unknown as { owner_user_id: string } | undefined;
      if (!owned || owned.owner_user_id !== ownerUserId) return false;
      const res = await db.batch(
        [
          { sql: 'DELETE FROM track_chunks WHERE track_id = ?', args: [id] },
          { sql: 'DELETE FROM tracks WHERE id = ?', args: [id] },
        ],
        'write',
      );
      return (res[1]?.rowsAffected ?? 0) > 0;
    },
  };
}
