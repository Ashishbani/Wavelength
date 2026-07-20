// Per-tab-session id used to de-duplicate seats for guests. sessionStorage is
// copied when a tab is *duplicated* (so duplicates share this id and take over
// one another) but is fresh in a brand-new tab (so those stay separate).
export function clientSessionId(): string {
  try {
    let id = sessionStorage.getItem('wl_session');
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem('wl_session', id);
    }
    return id;
  } catch {
    return 'anon';
  }
}
