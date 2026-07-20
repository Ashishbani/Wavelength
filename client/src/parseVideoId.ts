/** Accepts a full YouTube URL or a bare id and returns the 11-char id (or ''). */
export function parseVideoId(input: string): string {
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;
  const patterns = [/[?&]v=([A-Za-z0-9_-]{11})/, /youtu\.be\/([A-Za-z0-9_-]{11})/, /embed\/([A-Za-z0-9_-]{11})/];
  for (const p of patterns) {
    const m = input.match(p);
    if (m) return m[1];
  }
  return '';
}
