import { describe, it, expect } from 'vitest';
import { signToken, verifyToken } from './token.js';

describe('token', () => {
  it('signs and verifies a payload', () => {
    const t = signToken({ userId: 'u1' });
    expect(verifyToken(t)?.userId).toBe('u1');
  });
  it('returns null for a tampered token', () => {
    const t = signToken({ userId: 'u1' });
    expect(verifyToken(t + 'x')).toBeNull();
  });
  it('returns null for garbage', () => {
    expect(verifyToken('not-a-token')).toBeNull();
  });
});
