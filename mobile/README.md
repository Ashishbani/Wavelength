# Wavelength — Android app

A native Android app (Capacitor shell) that renders the **deployed** Wavelength
site. Remote mode means:

- Login/auth works exactly like the browser (same origin, same cookies).
- Every server deploy updates the app content instantly — no reinstalls.
- The APK only needs rebuilding when the *native* shell changes (icon, name,
  plugins), not for web fixes.

## Get an APK (no local Android SDK needed)

1. On GitHub → **Actions** → **Android APK** → **Run workflow**.
2. Enter your deployed URL (e.g. `https://wavelength-xxxx.onrender.com`).
3. When the run finishes, download the **wavelength-debug-apk** artifact.
4. Copy `app-debug.apk` to the phone and open it. Android will ask to allow
   installs from this source — allow it (it's a debug-signed sideload build).

## Build locally (requires Android Studio / SDK)

```bash
cd mobile
npm install
APP_URL=https://your-app.onrender.com npx cap sync android
cd android && ./gradlew assembleDebug
# APK at android/app/build/outputs/apk/debug/app-debug.apk
```

## Publishing to the Play Store (later)

- Create a release keystore and sign an `assembleRelease`/`bundleRelease` build.
- A Google Play developer account (one-time $25) is required.
- Consider bundling the web assets (instead of remote mode) for store review,
  and add a real launcher icon/splash before submitting.

## iOS

Needs a Mac with Xcode (`npx cap add ios`) and an Apple developer account.
Note Apple often rejects thin website wrappers (App Review 4.2); for iPhones,
the installable PWA (Safari → Share → Add to Home Screen) is the practical
path for now.
