# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install              # Install dependencies
pnpm dev                  # Vite dev server on :5173, proxies /api to bridge at :4080
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

Three-tier bridge: **React 19 SPA → Express bridge server → OpenCode process + provider proxy**.

### Frontend (React 19 + Zustand)

Built in Kanna's architecture pattern. Entry point: `src/main.tsx` → `src/client/app/App.tsx`.

**Zustand stores** (`src/client/stores/`):
- `connection.ts` — WebSocket lifecycle with exponential backoff reconnection
- `sessions.ts` — Session CRUD with optimistic creation and rollback
- `chat.ts` — Messages, streaming deltas, tool approvals, provider selection, notification handling

**Components** (`src/client/components/`):
- `layout/MainLayout.tsx` — App shell with sidebar toggle, provider selector, connection indicator
- `sidebar/Sidebar.tsx` — Session list grouped by project
- `chat/ChatPanel.tsx` — Message thread, input, approval queue, error banner
- `chat/ChatMessage.tsx` — Code block parsing, copy-to-clipboard
- `chat/ApprovalDialog.tsx` — Tool request approve/deny

**API client** (`src/client/api.ts`): RPC over HTTP + SSE streaming. Replaces the old Vue gateway.

### Backend flow

`src/server/index.ts` boots Express 5 + WebSocketServer. The `OpenCodeBridge` class (`bridge.ts`) spawns OpenCode via `@opencode-ai/sdk`'s `createOpencodeServer()` on port 4096 and communicates via JSON-RPC 2.0 over HTTP. If OpenCode isn't available, the server runs in proxy-only mode.

All `/api/rpc` POST requests forward to the bridge. When `Accept: text/event-stream`, the bridge uses `rpcStream()` which reads SSE chunks from OpenCode and simultaneously writes deltas to the HTTP response and broadcasts via WebSocket to all connected clients.

### Multi-tenant isolation

- Per-user WebSocket routing via `clientsByUser` map
- Session/request ownership tracking prevents cross-user access
- Login derives deterministic userId from password hash (SHA-256 first 8 hex chars)
- WebSocket auth checks cookie on upgrade
- Session list filtered by ownership

### Provider proxy layer

`src/server/proxy.ts` implements bidirectional **Responses API ↔ Chat Completions API** protocol translation with circuit breaker failover.

**Failover chain**: Zen (free) → OpenRouter `:free` models → Custom (BYOK). Circuit breaker trips after 3 failures, resets after 60s. 429/5xx triggers automatic failover to next provider.

### Auth

`src/server/auth.ts` uses SHA-256 hashed `timingSafeEqual` for password comparison. Sessions use HttpOnly cookies (`occ_session_token`) with 24h TTL. Rate limiting: 100 req/min per IP with periodic cleanup.

### Build targets

- **Frontend**: Vite + React builds to `dist/`. Path alias `@` → `src/`.
- **CLI**: tsup bundles `src/cli/index.ts` to `dist-cli/` as ESM with Node 18 target.
- **Dev proxy**: Vite proxies `/api` requests to `localhost:4080` with WebSocket upgrade support.

## Key patterns

- Express `json()` middleware runs globally — handlers receive parsed `req.body`
- Provider proxy must check `req.body` first (Express pre-parsed) before falling back to `readRequestBody()`
- `WebSocket` must be imported from `ws` package (not global) for Node <22 compatibility
- `navigator.clipboard` requires optional chaining (unavailable in non-HTTPS contexts)
- No `process.cwd()` in browser code — React components run client-side only
- Dynamic `import()` in server routes breaks after tsup bundling — use static imports
- Check `res.headersSent` before setting status codes in streaming error handlers
- Zustand stores use `getState()` for cross-store reads (e.g., chat store reads sessions store)

## Test suite

67 tests across 5 files:
- `tests/auth.test.ts` — Session creation, token validation, cookie parsing
- `tests/circuit-breaker.test.ts` — State machine, failover, reset behavior
- `tests/proxy.test.ts` — Protocol translation (Responses ↔ Chat Completions)
- `tests/server-api.test.ts` — API contract validation (RPC envelope, SSE, rate limiting)
- `tests/stores.test.ts` — Zustand store behavior (notifications, streaming, state merging)

## Reference projects

- [Kanna](https://github.com/jakemor/kanna) — Frontend architecture reference (React 19 + Zustand 5, WebSocket subscriptions, event-sourced state)
- [OpenCode](https://github.com/sst/opencode) — Backend SDK (`@opencode-ai/sdk`, Zen API)
