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
// Musical note with a plus — "add a song", clearer than a bare up-arrow.
export const AddSongIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
    <path d="M13 3v10.55A4 4 0 1 0 15 17V7h4V3z" />
    <path d="M4 7h2v2h2v2H6v2H4v-2H2V9h2z" />
  </svg>
);
