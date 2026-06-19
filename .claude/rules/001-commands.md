# Commands

```bash
pnpm install              # Install dependencies
pnpm dev                  # Vite dev server on :5173, proxies /api to bridge at :4080
pnpm build                # tsc type-check + vite build → dist/
pnpm build:cli            # tsup bundle → dist-cli/ (CLI entry with shebang)
pnpm preview              # Serve production build locally
pnpm typecheck            # tsc --noEmit
pnpm lint                 # eslint src/
pnpm test                 # vitest run (all tests)
pnpm test:watch           # vitest in watch mode

# Production: build CLI then run
node dist-cli/index.js serve --port 4080 --static-dir dist/
```
