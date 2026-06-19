# Architecture

Three-tier bridge: **React 19 SPA → Express bridge server → OpenCode process + provider proxy**.

### Frontend (React 19 + Zustand)

Entry: `src/main.tsx` → `src/client/app/App.tsx`. Zustand stores in `src/client/stores/` (connection, sessions, chat). Components in `src/client/components/`. API client in `src/client/api.ts`.

### Backend flow

`src/server/index.ts` boots Express 5 + WebSocketServer. `OpenCodeBridge` (`bridge.ts`) spawns OpenCode via `@opencode-ai/sdk` on port 4096 via JSON-RPC 2.0. Proxy-only mode if OpenCode unavailable.

### Provider proxy + failover

`src/server/proxy.ts` — bidirectional Responses API ↔ Chat Completions translation. Circuit breaker failover: Zen → OpenRouter → Custom. 3 failures trips breaker, 60s reset.

### Build targets

- **Frontend**: Vite + React → `dist/`. Path alias `@` → `src/`.
- **CLI**: tsup → `dist-cli/` as ESM, Node 18 target.
- **Dev proxy**: Vite proxies `/api` to `localhost:4080` with WS upgrade.
