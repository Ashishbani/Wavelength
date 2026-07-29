/**
 * Small bridge to the Capacitor native shell. The web build runs unchanged in a
 * browser — these helpers just report "not native" there, so no Capacitor
 * dependency is needed in the web bundle. Inside the Android app the native
 * layer injects window.Capacitor with the installed plugins.
 */

interface CapacitorBridge {
  isNativePlatform?: () => boolean;
  Plugins?: { App?: { exitApp?: () => void; minimizeApp?: () => void } };
}

function bridge(): CapacitorBridge | undefined {
  return (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor;
}

export function isNativeApp(): boolean {
  return bridge()?.isNativePlatform?.() === true;
}

/** Close the native app; in a browser, close/blank the tab as best we can. */
export function exitApp(): void {
  const app = bridge()?.Plugins?.App;
  if (app?.exitApp) { app.exitApp(); return; }
  // Browser: window.close() only works for script-opened tabs, so fall back to
  // going back in history (does nothing harmful if there's nowhere to go).
  window.close();
}
