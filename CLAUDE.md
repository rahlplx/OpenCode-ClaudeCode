# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install              # Install dependencies
pnpm dev                  # Vite dev server on :5173, proxies /api+/ws+/auth to bridge at :4080
pnpm build                # tsc type-check + vite build → dist/
pnpm build:cli            # tsup bundle → dist-cli/ (CLI entry with shebang)
pnpm preview              # Serve production build locally
pnpm typecheck            # tsc --noEmit
pnpm test                 # vitest run (all tests)
pnpm test:watch           # vitest in watch mode

# Production: build CLI then run
node dist-cli/index.js serve --port 4080 --static-dir dist/
```

## Architecture

Three-tier bridge: **Kanna React SPA → Express bridge server → OpenCode process + provider proxy**.

### Frontend — Kanna (verbatim)

Kanna's entire frontend is copied verbatim from [jakemor/kanna](https://github.com/jakemor/kanna). **Do not modify Kanna UI components** — only add responsive CSS or wire protocol adapters.

Entry point: `src/main.tsx` → `src/client/app/App.tsx`.

**State management** (`src/client/app/useKannaState.ts`): ~2100-line composable that owns all app state — sidebar, chat, settings, terminals. Connects to `KannaSocket` for real-time updates.

**KannaSocket** (`src/client/app/socket.ts`): WebSocket client with auto-reconnect (750ms initial, 5s max), 15s heartbeat, 25s stale detection. Speaks the subscribe/snapshot/command envelope protocol.

**Zustand stores** (`src/client/stores/`): 8 stores — appSettings, chatInput, chatPreferences, chatSoundPreferences, diffCommit, rightSidebar, terminalLayout, terminalPreferences.

**Shared types** (`src/shared/`): 12 files copied from Kanna — `types.ts` (1094 lines), `protocol.ts` (ClientEnvelope/ServerEnvelope/ClientCommand/SubscriptionTopic), `branding.ts`, `ports.ts`, etc.

### WebSocket protocol

Kanna uses a typed envelope protocol at `/ws`:
- **Client → Server**: `subscribe` (topic), `unsubscribe`, `command` (80+ command types)
- **Server → Client**: `snapshot` (state), `event` (delta), `ack` (command response), `error`
- **Topics**: sidebar, app-settings, keybindings, update, local-projects, chat, project-git, terminal

### Protocol adapter

`src/server/kanna-adapter.ts` bridges Kanna's WebSocket protocol to our Express backend. Handles subscription management, default snapshots, and command routing. Currently provides defaults for most topics — chat commands need wiring to the OpenCode bridge.

### Backend flow

`src/server/index.ts` boots Express 5 + WebSocketServer with `noServer: true` upgrade handling for both `/ws` (Kanna) and `/api/ws` (legacy).

The `OpenCodeBridge` class (`bridge.ts`) spawns OpenCode via `@opencode-ai/sdk`'s `createOpencodeServer()` on port 4096 and communicates via JSON-RPC 2.0 over HTTP.

### Auth routes

Kanna expects auth at top-level paths (no `/api` prefix):
- `GET /auth/status` → `{ enabled, authenticated }`
- `POST /auth/login` → sets cookie, returns `{ ok }`
- `POST /auth/logout` → clears cookie

Legacy routes remain at `/api/auth/login`, `/api/auth/logout`.

### Multi-tenant isolation

- Per-user WebSocket routing via `clientsByUser` map
- Session/request ownership tracking prevents cross-user access
- Login derives deterministic userId from password hash (SHA-256 first 8 hex chars)
- WebSocket auth checks cookie on upgrade

### Provider proxy layer

`src/server/proxy.ts` implements bidirectional **Responses API ↔ Chat Completions API** protocol translation with circuit breaker failover.

**Failover chain**: Zen (free) → OpenRouter `:free` models → Custom (BYOK). Circuit breaker trips after 3 failures, resets after 60s.

### Build targets

- **Frontend**: Vite + React 19 builds to `dist/`. Path alias `@` → `src/`.
- **CLI**: tsup bundles `src/cli/index.ts` to `dist-cli/` as ESM with Node 18 target.
- **Dev proxy**: Vite proxies `/ws`, `/api`, `/auth`, `/health` to `localhost:4080`.

### Responsive CSS

`src/index.css` includes Kanna's full stylesheet plus responsive enhancements:
- Mobile (<768px): touch targets, full-width dialogs, compact prose
- Tablet (768-1023px): narrower sidebar, panel min-widths
- Desktop (1024px+): full layout
- Ultra-wide (1440px+, 2560px+): wider prose columns
- Safe area insets, PWA standalone mode, reduced motion

## Key patterns

- Express `json()` middleware runs globally — handlers receive parsed `req.body`
- Provider proxy must check `req.body` first (Express pre-parsed) before falling back to `readRequestBody()`
- `WebSocket` must be imported from `ws` package (not global) for Node <22 compatibility
- `navigator.clipboard` requires optional chaining (unavailable in non-HTTPS contexts)
- No `process.cwd()` in browser code — React components run client-side only
- Dynamic `import()` in server routes breaks after tsup bundling — use static imports
- Check `res.headersSent` before setting status codes in streaming error handlers
- Kanna test files use `bun:test` — excluded from tsconfig and vitest config
- Kanna's WebSocket expects envelopes with `v: 1` version field

## Test suite

86 tests across 6 files:
- `tests/auth.test.ts` — Session creation, token validation, cookie parsing
- `tests/circuit-breaker.test.ts` — State machine, failover, reset behavior
- `tests/proxy.test.ts` — Protocol translation (Responses ↔ Chat Completions)
- `tests/server-api.test.ts` — API contract validation (RPC envelope, SSE, rate limiting)
- `tests/stores.test.ts` — Kanna Zustand store behavior (appSettings, chatInput, chatSoundPreferences, terminalPreferences, diffCommit)
- `tests/provider-config.test.ts` — ProviderConfigManager: BYOK config, Kanna↔server provider mapping, proxy entry generation, failover chain, validation

## Reference projects

- [Kanna](https://github.com/jakemor/kanna) — Frontend source (React 19 + Zustand 5, used verbatim)
- [OpenCode](https://github.com/sst/opencode) — Backend SDK (`@opencode-ai/sdk`, Zen API)
