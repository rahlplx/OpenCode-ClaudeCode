# Commands

```bash
pnpm install              # Install dependencies
pnpm dev                  # Vite dev server on :5173, proxies /api+/ws+/auth+/health to bridge at :4080
pnpm build                # tsc type-check + vite build → dist/
pnpm build:cli            # tsup bundle → dist-cli/ (CLI entry with shebang)
pnpm preview              # Serve production build locally
pnpm typecheck            # tsc --noEmit
pnpm lint                 # eslint src/server + src/cli (flat config, Kanna verbatim excluded)
pnpm test                 # vitest run (all tests)
pnpm test:watch           # vitest in watch mode
pnpm smoke                # Playwright smoke test: 9 steps, headless Chromium, screenshots → smoke-results/
pnpm smoke --json         # machine-readable JSON report for AI diagnosis loop
pnpm playwright:install   # one-time: download Chromium (~300MB) for smoke tests

# Electron (Windows EXE / Mac DMG / Linux AppImage)
pnpm electron:dev         # build + launch Electron window locally
pnpm build:win            # → dist-electron/*.exe (portable + NSIS)
pnpm build:mac            # → dist-electron/*.dmg
pnpm build:linux          # → dist-electron/*.AppImage

# Android APK (Capacitor)
pnpm build:android        # pnpm build + cap sync android
pnpm cap:sync             # cap sync android (after build)
# Then open android/ in Android Studio → Build → Generate Signed APK

# Production: build CLI then run
node dist-cli/index.js serve --port 4080 --static-dir dist/
```
