import jwt from 'jsonwebtoken';

export interface TokenPayload {
  userId: string;
}

export function getSecret(): string {
  const s = process.env.JWT_SECRET;
  // A real secret is required to run the server anywhere (no NODE_ENV gating).
  if (s && s !== 'change-me-in-production') return s;
  if (process.env.NODE_ENV === 'test') return 'test-secret';
  throw new Error('JWT_SECRET must be set to a strong, unique secret before starting the server (see .env.example).');
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: '7d' });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, getSecret());
    if (typeof decoded === 'object' && decoded && 'userId' in decoded) {
      return { userId: String((decoded as { userId: unknown }).userId) };
    }
    return null;
  } catch {
    return null;
  }
}
