# Deployment targets

Current status and recommended approach for each platform:

## Already working
- **Webapp** — React SPA served from `dist/` by the Express bridge
- **Self-hosted (laptop/PC/VPS)** — `node dist-cli/index.js serve --port 4080 --static-dir dist/`

## Planned

### Docker / VPS cloud
- Add `Dockerfile` (Node 18 slim, `COPY dist/ dist-cli/ package.json`, `CMD node dist-cli/index.js serve`)
- Add `docker-compose.yml` for single-command local stack
- Expose port 4080; reverse-proxy with nginx/Caddy for TLS

### Windows EXE
- **Electron** — bundles Node.js + Chromium; bridge runs in main process, UI in renderer window (~150 MB installer)
- **Alternative**: `pkg` / `nexe` — packages just the CLI as `.exe`; user opens browser manually (~50 MB, no Chromium)
- Electron preferred for end-user UX; pkg for server-operator CLI

### Android APK
- **PWA first** — add `public/manifest.json` + service-worker for offline shell; installable from Chrome on Android, no APK build required
- **Capacitor** — wraps the built `dist/` as a native Android app; bridge must run on a reachable server (not on device)
- Do PWA before Capacitor; Capacitor adds native plugins (camera, filesystem) if needed later

### iOS
- Same Capacitor path as Android once PWA is proven

## Pattern
Serve the static SPA from any origin; the default bridge URL is set at build-time via env var `VITE_API_BASE` (Vite replaces it statically — not available at runtime in the browser). Runtime overrides are handled via query param `?server=https://...` read from `window.location.search`. This decouples the UI package from the server and enables one APK/EXE that connects to any self-hosted or cloud instance.
