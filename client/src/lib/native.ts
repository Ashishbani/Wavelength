/**
 * Small bridge to the Capacitor native shell. The web build runs unchanged in a
 * browser — these helpers just report "not native" there, so no Capacitor
 * dependency is needed in the web bundle. Inside the Android app the native
 * layer injects window.Capacitor with the installed plugins.
 */

interface ListenerHandle { remove?: () => unknown }
interface AppPlugin {
  exitApp?: () => void;
  minimizeApp?: () => void;
  addListener?: (event: string, cb: () => void) => ListenerHandle | Promise<ListenerHandle>;
}
interface CapacitorBridge {
  isNativePlatform?: () => boolean;
  Plugins?: { App?: AppPlugin };
  /** Low-level bridge listener API (present in the native runtime). */
  addListener?: (plugin: string, event: string, cb: () => void) => ListenerHandle;
}

function bridge(): CapacitorBridge | undefined {
  return (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor;
}

export function isNativeApp(): boolean {
  return bridge()?.isNativePlatform?.() === true;
}

/**
 * Handle the Android hardware Back button directly. Registering this also tells
 * the native shell to stop doing its own WebView-history back handling, which is
 * what made Back unreliable in the app (a restored WebView could come back with
 * no history to pop, so Back closed the app instead of reaching our prompts).
 * Returns a cleanup function; a no-op in the browser.
 */
export function onNativeBack(handler: () => void): () => void {
  const cap = bridge();
  if (!cap) return () => {};

  // A single press can arrive on more than one channel; those duplicates land in
  // the same tick, so collapse only near-simultaneous calls — a window long
  // enough to swallow a genuine second press would break rapid Back taps.
  let last = 0;
  const fire = () => {
    const now = Date.now();
    if (now - last < 50) return;
    last = now;
    handler();
  };

  const handles: ListenerHandle[] = [];
  const keep = (res: ListenerHandle | Promise<ListenerHandle> | undefined) => {
    if (!res) return;
    if (typeof (res as Promise<ListenerHandle>).then === 'function') {
      void (res as Promise<ListenerHandle>).then((h) => { if (h) handles.push(h); });
    } else {
      handles.push(res as ListenerHandle);
    }
  };

  // Register on every channel the native shell may deliver Back through, so the
  // app never falls back to its own (unreliable) history handling.
  try { keep(cap.Plugins?.App?.addListener?.('backButton', fire)); } catch { /* not available */ }
  try { keep(cap.addListener?.('App', 'backButton', fire)); } catch { /* not available */ }
  document.addEventListener('backbutton', fire); // legacy/Cordova-style event

  return () => {
    for (const h of handles) { try { void h.remove?.(); } catch { /* ignore */ } }
    document.removeEventListener('backbutton', fire);
  };
}

/** Close the native app; in a browser, close/blank the tab as best we can. */
export function exitApp(): void {
  const app = bridge()?.Plugins?.App;
  if (app?.exitApp) { app.exitApp(); return; }
  // Browser: window.close() only works for script-opened tabs, so fall back to
  // going back in history (does nothing harmful if there's nowhere to go).
  window.close();
}
