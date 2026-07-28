import { describe, it, expect } from 'vitest';
import { parseFrom } from './mailer.js';

describe('parseFrom', () => {
  it('splits "Name <addr>" into parts', () => {
    expect(parseFrom('Wavelength <noreply@example.com>')).toEqual({ name: 'Wavelength', email: 'noreply@example.com' });
  });
  it('handles a quoted name', () => {
    expect(parseFrom('"Wavelength App" <a@b.com>')).toEqual({ name: 'Wavelength App', email: 'a@b.com' });
  });
  it('handles a bare address', () => {
    expect(parseFrom('a@b.com')).toEqual({ email: 'a@b.com' });
  });
  it('handles empty display name', () => {
    expect(parseFrom('<a@b.com>')).toEqual({ email: 'a@b.com' });
  });
});
