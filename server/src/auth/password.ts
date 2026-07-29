import bcrypt from 'bcryptjs';

// bcrypt work factor. 12 costs ~2s per hash/compare on a small shared-CPU host,
// which made every login feel broken; 10 is ~4x faster (~0.5s) and still at or
// above current OWASP guidance for bcrypt. Override with BCRYPT_COST if the
// host has more CPU to spare.
const COST = Number(process.env.BCRYPT_COST) || 10;

export function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, COST);
}

export function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}
