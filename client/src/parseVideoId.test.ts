import { describe, it, expect } from 'vitest';
import { parseVideoId } from './parseVideoId.js';

describe('parseVideoId', () => {
  it('passes a bare id through', () => {
    expect(parseVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('extracts from a watch url', () => {
    expect(parseVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1')).toBe('dQw4w9WgXcQ');
  });
  it('extracts from a youtu.be url', () => {
    expect(parseVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('returns empty for garbage', () => {
    expect(parseVideoId('not a link')).toBe('');
  });
});
