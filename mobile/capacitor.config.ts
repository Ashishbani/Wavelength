import type { CapacitorConfig } from '@capacitor/cli';

// Remote-mode shell: the native app renders the DEPLOYED Wavelength site, so
// auth cookies work exactly like the browser and every server deploy updates
// the app instantly (no reinstall). Set APP_URL when running `cap sync`:
//   APP_URL=https://your-app.onrender.com npx cap sync android
const url = process.env.APP_URL;

const config: CapacitorConfig = {
  appId: 'com.ashishbani.wavelength',
  appName: 'Wavelength',
  webDir: 'www', // fallback splash only — the real UI is served remotely
  backgroundColor: '#080813',
  ...(url ? { server: { url, cleartext: false } } : {}),
  android: {
    allowMixedContent: false,
  },
};

export default config;
