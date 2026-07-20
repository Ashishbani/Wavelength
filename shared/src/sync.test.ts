import { describe, it, expect } from 'vitest';
import { estimateOffset, effectivePosition, isDrifted, isValidVideoId } from './sync.js';

describe('estimateOffset', () => {
  it('centers on the round-trip midpoint', () => {
    // t0=1000, t1=1200 -> midpoint 1100; server said 1150 -> offset 50
    expect(estimateOffset(1000, 1200, 1150)).toBe(50);
  });
});

describe('effectivePosition', () => {
  it('returns positionSec unchanged when paused', () => {
    const p = { videoId: 'x', isPlaying: false, positionSec: 42, lastUpdateServerTs: 1000 };
    expect(effectivePosition(p, 9999)).toBe(42);
  });

  it('advances by elapsed seconds when playing', () => {
    const p = { videoId: 'x', isPlaying: true, positionSec: 10, lastUpdateServerTs: 1000 };
    // 3500ms later -> 10 + 3.5 = 13.5
    expect(effectivePosition(p, 4500)).toBe(13.5);
  });
});

describe('isDrifted', () => {
  it('is false within threshold', () => {
    expect(isDrifted(10, 10.4)).toBe(false);
  });
  it('is true beyond threshold', () => {
    expect(isDrifted(10, 12)).toBe(true);
  });
});

describe('isValidVideoId', () => {
  it('accepts an 11-char id', () => {
    expect(isValidVideoId('dQw4w9WgXcQ')).toBe(true);
  });
  it('rejects wrong length or type', () => {
    expect(isValidVideoId('short')).toBe(false);
    expect(isValidVideoId(123)).toBe(false);
  });
});
