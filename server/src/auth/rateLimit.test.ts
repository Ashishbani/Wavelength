import { describe, it, expect } from 'vitest';
import { createRateLimiter } from './rateLimit.js';

describe('rateLimit', () => {
  it('allows up to max then blocks', () => {
    const rl = createRateLimiter({ windowMs: 60_000, max: 3 });
    expect(rl.check('ip1')).toBe(true);
    expect(rl.check('ip1')).toBe(true);
    expect(rl.check('ip1')).toBe(true);
    expect(rl.check('ip1')).toBe(false);
  });
  it('tracks keys independently', () => {
    const rl = createRateLimiter({ windowMs: 60_000, max: 1 });
    expect(rl.check('ip1')).toBe(true);
    expect(rl.check('ip2')).toBe(true);
    expect(rl.check('ip1')).toBe(false);
  });
});
