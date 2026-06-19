# Deployment targets

Current status and recommended approach for each platform:

## Already working
- **Webapp** — React SPA served from `dist/` by the Express bridge
- **Self-hosted (laptop/PC/VPS)** — `node dist-cli/index.js serve --port 4080 --static-dir dist/`
- **Docker / VPS cloud** — `Dockerfile` + `docker-compose.yml`; multi-stage build, exposes port 4080
- **PWA** — `public/sw.js` + `public/manifest.webmanifest`; installable from Chrome on Android, offline shell
- **Windows EXE** — Electron (`pnpm build:win`); bundles bridge + Chromium, outputs portable + NSIS installer
- **Android APK** — Capacitor (`pnpm build:android`); WebView wrapper, connects to remote OpenCode server via `OPENCODE_SERVER_URL`

## Planned

### iOS
- Same Capacitor path as Android: `npx cap add ios`, open in Xcode, build IPA
- Requires macOS + Xcode; sign with Apple Developer account

## Capacitor / Android notes
- `capacitor.config.ts` — set `OPENCODE_SERVER_URL=https://your-server.com` at build time to point the APK at your instance
- Without `OPENCODE_SERVER_URL`, the WebView loads local SPA assets but API calls need a server (use for testing only)
- `pnpm build:android` = `pnpm build` + `cap sync android` — copies built SPA into `android/app/src/main/assets/public/`
- Open `android/` in Android Studio → Build → Generate Signed Bundle/APK
- `android/.gradle/`, `android/app/build/`, `android/build/` are gitignored; commit everything else

## Electron notes
- `asar: false` required — ESM `import()` fails inside ASAR archive
- `pathToFileURL` for Windows drive-letter path safety
- `shell.openExternal` validates `http:` or `https:` protocol only (RCE guard)
- `getPath(...parts)` resolves relative to `__dirname/../` (works in both dev and packaged)
- Health-poll loop before `createWindow()` — gives bridge up to 15s to start, retries every 300ms

## Pattern
The bridge (`startServer`) always runs on a server — either the user's machine (Electron/self-hosted) or a remote VPS (Docker/Capacitor). The SPA connects to it via relative paths (Electron/self-hosted) or the absolute `server.url` set in `capacitor.config.ts`. `VITE_API_BASE` is build-time only (Vite static replace); runtime server override is not yet implemented.
