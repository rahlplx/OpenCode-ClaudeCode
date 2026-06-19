# OpenCode-ClaudeCode

Multi-tenant, LLM-agnostic AI coding agent with **Kanna web UI** and **BYOK** (Bring Your Own Key) support.

Get a full-featured AI coding assistant with zero API costs via OpenCode Zen free tier, or bring your own provider.

## Architecture

```
Kanna (React 19) → Express 5 Bridge → OpenCode SDK → Zen / OpenRouter / Custom (BYOK)
```

- **Frontend**: [Kanna](https://github.com/jakemor/kanna) React 19 + Zustand 5 SPA (used verbatim, responsive CSS added)
- **Bridge**: Express 5 + WebSocket with Kanna protocol adapter, JSON-RPC proxy, multi-tenant isolation
- **Backend**: OpenCode process (via `@opencode-ai/sdk`) with multi-provider proxy + circuit breaker failover

## Free Token Strategy

1. **OpenCode Zen** (primary) — Free tier at `opencode.ai/zen/v1` (Claude Sonnet 4.6, Haiku 4.5, GPT-4.1 Mini)
2. **OpenRouter Free Models** (secondary) — Auto-discovers models ending in `:free`
3. **Custom Endpoint (BYOK)** — Bring your own API key for any OpenAI-compatible provider

## Quick Start

```bash
pnpm install
pnpm dev          # Dev server at :5173, proxies to bridge at :4080

pnpm build        # Production build
pnpm build:cli
node dist-cli/index.js serve --port 4080 --static-dir dist/
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Zustand 5, Tailwind CSS 4, Vite 6 |
| Backend | Node.js 18+, Express 5, WebSocket (ws) |
| AI | OpenCode SDK, Zen API, OpenRouter, BYOK |
| Build | tsup (CLI), Vite (frontend), Vitest (tests) |

## Features

- Kanna web UI with responsive design (mobile/tablet/desktop/ultra-wide)
- Multi-provider support with circuit breaker failover (Zen → OpenRouter → Custom)
- BYOK: configure any OpenAI-compatible provider from the settings UI
- Multi-tenant isolation with per-user WebSocket routing
- Streaming AI responses via WebSocket/SSE
- Tool execution with user approval flow
- Session/thread management grouped by project
- PWA support with offline manifest
- Session authentication with HttpOnly cookies

## License

MIT
