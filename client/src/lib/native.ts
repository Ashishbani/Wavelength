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
  const app = bridge()?.Plugins?.App;
  if (!app?.addListener) return () => {};
  let handle: ListenerHandle | undefined;
  const res = app.addListener('backButton', () => handler());
  if (res && typeof (res as Promise<ListenerHandle>).then === 'function') {
    void (res as Promise<ListenerHandle>).then((h) => { handle = h; });
  } else {
    handle = res as ListenerHandle;
  }
  return () => { void handle?.remove?.(); };
}

/** Close the native app; in a browser, close/blank the tab as best we can. */
export function exitApp(): void {
  const app = bridge()?.Plugins?.App;
  if (app?.exitApp) { app.exitApp(); return; }
  // Browser: window.close() only works for script-opened tabs, so fall back to
  // going back in history (does nothing harmful if there's nowhere to go).
  window.close();
}
