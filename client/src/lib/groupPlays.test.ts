import { describe, it, expect } from 'vitest';
import { groupPlaysByDay, dayLabel } from './groupPlays.js';

/** A local-time timestamp, so the tests exercise real local-day boundaries. */
function at(y: number, m: number, d: number, h = 12, min = 0): number {
  return new Date(y, m - 1, d, h, min).getTime();
}

describe('groupPlaysByDay', () => {
  const now = at(2026, 7, 29, 18);

  it('collapses repeats within a day but keeps them across days', () => {
    const days = groupPlaysByDay([
      { videoId: 'a', title: 'Song A', playedAt: at(2026, 7, 29, 9) },
      { videoId: 'a', title: 'Song A', playedAt: at(2026, 7, 29, 10) },
      { videoId: 'a', title: 'Song A', playedAt: at(2026, 7, 29, 11) },
      { videoId: 'b', title: 'Song B', playedAt: at(2026, 7, 29, 8) },
      { videoId: 'a', title: 'Song A', playedAt: at(2026, 7, 28, 20) }, // yesterday
    ], now);

    expect(days.map((d) => d.label)).toEqual(['Today', 'Yesterday']);
    const today = days[0];
    expect(today.items.map((i) => [i.title, i.plays])).toEqual([['Song A', 3], ['Song B', 1]]);
    // the kept timestamp is the latest play that day
    expect(today.items[0].playedAt).toBe(at(2026, 7, 29, 11));
    // and yesterday still lists it separately
    expect(days[1].items.map((i) => [i.title, i.plays])).toEqual([['Song A', 1]]);
  });

  it('orders days and entries newest first', () => {
    const days = groupPlaysByDay([
      { videoId: 'old', title: 'Old', playedAt: at(2026, 7, 20, 12) },
      { videoId: 'new', title: 'New', playedAt: at(2026, 7, 29, 12) },
      { videoId: 'mid', title: 'Mid', playedAt: at(2026, 7, 27, 12) },
    ], now);
    expect(days.map((d) => d.items[0].title)).toEqual(['New', 'Mid', 'Old']);
  });

  it('labels days by recency', () => {
    expect(dayLabel(at(2026, 7, 29, 1), now)).toBe('Today');
    expect(dayLabel(at(2026, 7, 28, 23), now)).toBe('Yesterday');
    expect(dayLabel(at(2026, 7, 27, 12), now)).toBe('Monday');   // within the week
    expect(dayLabel(at(2026, 7, 1, 12), now)).toMatch(/2026/);   // older → dated
  });

  it('handles an empty list', () => {
    expect(groupPlaysByDay([], now)).toEqual([]);
  });
});
