export interface Play { videoId: string; title: string; playedAt: number }

export interface GroupedPlay {
  videoId: string;
  title: string;
  /** Most recent play within that day. */
  playedAt: number;
  /** How many times it played that day. */
  plays: number;
}

export interface PlayDay {
  /** Local day key (YYYY-M-D) — stable React key. */
  key: string;
  /** "Today" / "Yesterday" / "Tuesday" / "12 Jul 2026". */
  label: string;
  items: GroupedPlay[];
}

function startOfLocalDay(ts: number): Date {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** "Today", "Yesterday", a weekday name within the past week, else a date. */
export function dayLabel(ts: number, now = Date.now()): string {
  const day = startOfLocalDay(ts).getTime();
  const today = startOfLocalDay(now).getTime();
  const diffDays = Math.round((today - day) / 86_400_000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return new Date(ts).toLocaleDateString(undefined, { weekday: 'long' });
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Group plays into local days, newest first, collapsing repeats *within* a day
 * into one row with a count — so a song played three times today reads
 * "Song ×3" instead of three identical rows, while still appearing again under
 * another day you played it.
 */
export function groupPlaysByDay(plays: Play[], now = Date.now()): PlayDay[] {
  const days = new Map<string, PlayDay>();
  for (const p of [...plays].sort((a, b) => b.playedAt - a.playedAt)) {
    const d = startOfLocalDay(p.playedAt);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    let day = days.get(key);
    if (!day) {
      day = { key, label: dayLabel(p.playedAt, now), items: [] };
      days.set(key, day);
    }
    const existing = day.items.find((i) => i.videoId === p.videoId);
    if (existing) {
      existing.plays += 1;
      existing.playedAt = Math.max(existing.playedAt, p.playedAt);
    } else {
      day.items.push({ videoId: p.videoId, title: p.title, playedAt: p.playedAt, plays: 1 });
    }
  }
  return [...days.values()];
}

/** Time of day, e.g. "4:12 pm". */
export function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export interface TopTrack {
  videoId: string;
  title: string;
  /** Times played in the window. */
  plays: number;
  /** Most recent play, used to break ties. */
  lastPlayedAt: number;
}

/**
 * Most-played tracks in a window, busiest first. Ties break toward whatever you
 * played most recently, so a fresh favourite outranks an older one on equal
 * counts.
 */
export function topTracks(plays: Play[], sinceTs = 0, limit = 10): TopTrack[] {
  const byTrack = new Map<string, TopTrack>();
  for (const p of plays) {
    if (p.playedAt < sinceTs) continue;
    const found = byTrack.get(p.videoId);
    if (found) {
      found.plays += 1;
      found.lastPlayedAt = Math.max(found.lastPlayedAt, p.playedAt);
    } else {
      byTrack.set(p.videoId, { videoId: p.videoId, title: p.title, plays: 1, lastPlayedAt: p.playedAt });
    }
  }
  return [...byTrack.values()]
    .sort((a, b) => b.plays - a.plays || b.lastPlayedAt - a.lastPlayedAt)
    .slice(0, limit);
}
