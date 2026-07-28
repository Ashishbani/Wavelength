import type { CSSProperties } from 'react';

// Simple, pixel-aligned media-control icons (SVG beats emoji glyphs, which
// render at inconsistent sizes/baselines across platforms).
export const PrevIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
    <path d="M7 6h2v12H7z" />
    <path d="M19 6v12l-9-6z" />
  </svg>
);
export const NextIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
    <path d="M15 6h2v12h-2z" />
    <path d="M5 6v12l9-6z" />
  </svg>
);
export const PlayIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
    <path d="M8 5v14l11-7z" />
  </svg>
);
export const PauseIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
    <path d="M7 5h3.2v14H7zM13.8 5H17v14h-3.2z" />
  </svg>
);
// Soundwave — the app's "music" mark: five rounded bars, tallest centered.
export const WaveIcon = ({ size = 16 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
    <rect x="1" y="8" width="3" height="8" rx="1.5" />
    <rect x="5.75" y="5" width="3" height="14" rx="1.5" />
    <rect x="10.5" y="2" width="3" height="20" rx="1.5" />
    <rect x="15.25" y="5" width="3" height="14" rx="1.5" />
    <rect x="20" y="8" width="3" height="8" rx="1.5" />
  </svg>
);
// Animated 5-bar equalizer (symmetric wave); styling comes from the className.
export const EqBars = ({ className, style }: { className: string; style?: CSSProperties }) => (
  <span className={className} style={style}><span /><span /><span /><span /><span /></span>
);
// Chain link — invite/share.
export const LinkIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </svg>
);
// Door with an outward arrow — leave the room.
export const LeaveIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);
// Musical note with a plus — "add a song", clearer than a bare up-arrow.
export const AddSongIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
    <path d="M13 3v10.55A4 4 0 1 0 15 17V7h4V3z" />
    <path d="M4 7h2v2h2v2H6v2H4v-2H2V9h2z" />
  </svg>
);
