import { useEffect, useState } from 'react';
import { applyTheme, readThemePref, resolveTheme, saveThemePref, watchSystemTheme, type ThemePref } from '../lib/theme.js';

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
/**
 * A straight Day ↔ Night switch. Until it's used, the stored preference is
 * 'system', so a first visit matches the device (and follows it live); the
 * first tap pins an explicit choice.
 */
export default function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(readThemePref);
  const current = resolveTheme(pref);

  useEffect(() => {
    applyTheme(pref);
    saveThemePref(pref);
    if (pref !== 'system') return;
    return watchSystemTheme(() => applyTheme('system'));
  }, [pref]);

  const target = current === 'dark' ? 'light' : 'dark';
  const label = target === 'light' ? 'Switch to day mode' : 'Switch to night mode';

  return (
    <button className="theme-toggle" onClick={() => setPref(target)} title={label} aria-label={label}>
      {/* the icon shows what you'd get, not where you are */}
      {target === 'light' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
