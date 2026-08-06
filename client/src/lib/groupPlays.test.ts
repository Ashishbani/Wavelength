import { describe, it, expect } from 'vitest';
import { groupPlaysByDay, dayLabel, topTracks } from './groupPlays.js';

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

describe('topTracks', () => {
  const now = at(2026, 7, 29, 18);
  const plays = [
    { videoId: 'a', title: 'A', playedAt: at(2026, 7, 29, 9) },
    { videoId: 'a', title: 'A', playedAt: at(2026, 7, 28, 9) },
    { videoId: 'b', title: 'B', playedAt: at(2026, 7, 29, 10) },
    { videoId: 'b', title: 'B', playedAt: at(2026, 7, 29, 11) },
    { videoId: 'b', title: 'B', playedAt: at(2026, 7, 20, 11) },
    { videoId: 'c', title: 'C', playedAt: at(2026, 7, 10, 11) },
  ];

  it('ranks by play count, busiest first', () => {
    expect(topTracks(plays).map((t) => [t.title, t.plays])).toEqual([['B', 3], ['A', 2], ['C', 1]]);
  });

  it('honours the window', () => {
    const weekAgo = at(2026, 7, 23, 0);
    expect(topTracks(plays, weekAgo).map((t) => [t.title, t.plays])).toEqual([['B', 2], ['A', 2]]);
  });

  it('breaks ties toward the more recently played track', () => {
    const tie = [
      { videoId: 'old', title: 'Old', playedAt: at(2026, 7, 20, 9) },
      { videoId: 'new', title: 'New', playedAt: at(2026, 7, 29, 9) },
    ];
    expect(topTracks(tie).map((t) => t.title)).toEqual(['New', 'Old']);
  });

  it('limits the list', () => {
    expect(topTracks(plays, 0, 2)).toHaveLength(2);
  });

  it('handles no plays', () => {
    expect(topTracks([], 0)).toEqual([]);
  });
  void now;
});
