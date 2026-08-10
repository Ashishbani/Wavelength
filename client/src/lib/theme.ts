export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'wl_theme';

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch { /* private mode */ }
  return 'system';
}

export function saveThemePref(pref: ThemePref): void {
  try { localStorage.setItem(KEY, pref); } catch { /* private mode */ }
}

/** What 'system' currently resolves to. */
export function systemTheme(): 'light' | 'dark' {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  return pref === 'system' ? systemTheme() : pref;
}

/**
 * Paint the theme: the attribute drives the CSS palette, and theme-color keeps
 * the mobile browser/PWA chrome in step with it.
 */
export function applyTheme(pref: ThemePref): 'light' | 'dark' {
  const theme = resolveTheme(pref);
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#fbfaff' : '#080813');
  return theme;
}

/** Follow the OS while the preference is 'system'. Returns an unsubscribe. */
export function watchSystemTheme(onChange: () => void): () => void {
  const mq = window.matchMedia?.('(prefers-color-scheme: light)');
  if (!mq) return () => {};
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
