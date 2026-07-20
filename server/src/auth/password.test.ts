import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password', () => {
  it('hashes and verifies a correct password', async () => {
    const hash = await hashPassword('hunter2secret');
    expect(hash).not.toBe('hunter2secret');
    expect(await verifyPassword('hunter2secret', hash)).toBe(true);
  });
  it('rejects a wrong password', async () => {
    const hash = await hashPassword('hunter2secret');
    expect(await verifyPassword('wrongpass', hash)).toBe(false);
  });
});
