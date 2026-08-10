import { useEffect, useState } from 'react';
import { applyTheme, readThemePref, saveThemePref, watchSystemTheme, type ThemePref } from '../lib/theme.js';

const SunIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
const MoonIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" />
  </svg>
);
const AutoIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
  </svg>
);

const ORDER: ThemePref[] = ['system', 'light', 'dark'];
const LABEL: Record<ThemePref, string> = { system: 'System theme', light: 'Day mode', dark: 'Night mode' };

/**
 * Cycles System → Day → Night. On 'system' it follows the device setting live,
 * so a phone switching to dark at sunset takes the app with it.
 */
export default function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(readThemePref);

  useEffect(() => {
    applyTheme(pref);
    saveThemePref(pref);
    if (pref !== 'system') return;
    return watchSystemTheme(() => applyTheme('system'));
  }, [pref]);

  const next = () => setPref(ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length]);
  const Icon = pref === 'light' ? SunIcon : pref === 'dark' ? MoonIcon : AutoIcon;

  return (
    <button className="theme-toggle" onClick={next} title={`${LABEL[pref]} — tap to change`} aria-label={LABEL[pref]}>
      <Icon />
    </button>
  );
}
