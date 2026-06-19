# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install              # Install dependencies
pnpm dev                  # Vite dev server on :5173, proxies /api to bridge at :4080
pnpm build                # vue-tsc type-check + vite build → dist/
pnpm build:cli            # tsup bundle → dist-cli/ (CLI entry with shebang)
pnpm preview              # Serve production build locally
pnpm typecheck            # vue-tsc --noEmit
pnpm lint                 # eslint src/
pnpm test                 # vitest run (all tests)
pnpm test:watch           # vitest in watch mode

# Production: build CLI then run
node dist-cli/index.js serve --port 4080 --static-dir dist/
```

## Architecture

Three-tier bridge: **Vue 3 SPA → Express bridge server → OpenCode process + provider proxy**.

### Backend flow

`src/server/index.ts` boots Express 5 + WebSocketServer. The `OpenCodeBridge` class (`bridge.ts`) spawns OpenCode via `@opencode-ai/sdk`'s `createOpencodeServer()` on port 4096 and communicates via JSON-RPC 2.0 over HTTP. If OpenCode isn't available, the server runs in proxy-only mode.

All `/api/rpc` POST requests forward to the bridge. When `Accept: text/event-stream`, the bridge uses `rpcStream()` which reads SSE chunks from OpenCode and simultaneously writes deltas to the HTTP response and broadcasts via WebSocket to all connected clients.

### Provider proxy layer

`src/server/proxy.ts` implements bidirectional **Responses API ↔ Chat Completions API** protocol translation. Key functions:
- `responsesToChatCompletions()` — converts Responses-format request to Chat Completions payload
- `chatCompletionsToResponses()` — converts Chat Completions response back to Responses format
- `convertStreamChunkToResponses()` — transforms streaming Chat Completions SSE deltas into Responses SSE events

Each provider (`src/providers/`) defines its endpoint URLs, wire format preference, and header builder. The proxy routes through `/api/proxy/:provider/v1/responses`.

**Provider hierarchy**: OpenCode Zen (free, primary) → OpenRouter `:free` models (secondary, 10-min cached discovery) → Custom endpoint (user key).

### Frontend state

All UI state lives in a single composable `useAgentState()` (`src/composables/useAgentState.ts`). This follows the codex-mobile pattern: one file owns sessions, messages, models, provider config, and UI state. Messages are split into `persistedMessages` (server-confirmed) and `liveStreamMessages` (in-flight deltas) which merge in the `currentMessages` computed.

WebSocket notifications drive state updates. A 220ms debounce (`EVENT_SYNC_DEBOUNCE_MS`) coalesces rapid notification-driven session list refreshes.

Session creation uses optimistic insertion — the UI adds a temp session immediately, then replaces it with the server response or rolls back on error.

### API gateway

`src/api/gateway.ts` is the frontend's RPC client. For streaming, it sends `Accept: text/event-stream` and parses SSE lines from the response body reader. It also manages the WebSocket connection for push notifications.

### Auth

`src/server/auth.ts` uses SHA-256 hashed `timingSafeEqual` for password comparison (no length-based timing leak). Sessions use HttpOnly cookies (`occ_session_token`) with 24h TTL.

### Build targets

- **Frontend**: Vite builds to `dist/`. Path alias `@` → `src/`.
- **CLI**: tsup bundles `src/cli/index.ts` to `dist-cli/` as ESM with Node 18 target. Express, Commander, ws, and @opencode-ai/sdk are external (not bundled).
- **Dev proxy**: Vite proxies `/api` requests to `localhost:4080` with WebSocket upgrade support.

## Key patterns

- Express `json()` middleware runs globally — handlers receive parsed `req.body`, never read the raw stream manually
- Provider proxy must check `req.body` first (Express pre-parsed) before falling back to `readRequestBody()`
- `WebSocket` must be imported from `ws` package (not global) for Node <22 compatibility
- `navigator.clipboard` requires optional chaining (unavailable in non-HTTPS contexts)
- No `process.cwd()` in browser code — Vue composables run client-side only
- Dynamic `import()` in server routes breaks after tsup bundling — use static imports
- Check `res.headersSent` before setting status codes in streaming error handlers

## Reference projects

- [codex-mobile](https://github.com/friuns2/codex-mobile) — architectural ancestor (Vue 3 bridge pattern, provider proxy, free mode)
- [Kanna](https://github.com/jakemor/kanna) — target web UI (React + Zustand + Bun, event-sourced state, Claude/Codex agent coordination)
- [OpenCode](https://github.com/sst/opencode) — backend SDK (`@opencode-ai/sdk`, Zen API, JS SDK at `packages/sdk/js`)
