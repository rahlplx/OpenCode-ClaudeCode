# OpenCode-ClaudeCode

AI coding agent that combines **OpenCode's free LLM infrastructure** with a **Claude Code-inspired web UI**.

Get a full-featured AI coding assistant with zero API costs by leveraging OpenCode Zen API and OpenRouter free models as the backend.

## Architecture

```
Browser (Vue 3) → Express Bridge → OpenCode SDK → Zen API / OpenRouter (Free)
```

Three-tier design inspired by [codex-mobile](https://github.com/friuns2/codex-mobile):
- **Browser Layer**: Vue 3 SPA with chat interface, sidebar, tool approval dialogs
- **Bridge Layer**: Express 5 server with JSON-RPC proxy, WebSocket notifications, provider routing
- **Backend Layer**: OpenCode process (via `@opencode-ai/sdk`) with multi-provider proxy

## Free Token Strategy

1. **OpenCode Zen** (primary) — Free tier at `opencode.ai/zen/v1`
2. **OpenRouter Free Models** (secondary) — Auto-discovers models ending in `:free`
3. **Custom Endpoint** — Bring your own API key

## Quick Start

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build

# Start production server
pnpm build:cli
node dist-cli/index.js serve
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vue 3, TypeScript, Tailwind CSS 4, Vite 6 |
| Backend | Node.js 18+, Express 5, WebSocket |
| AI | OpenCode SDK, Zen API, OpenRouter |
| Build | tsup (CLI), Vite (frontend), Vitest (tests) |

## Features

- Streaming AI responses via WebSocket/SSE
- Multi-provider support with automatic fallback
- Tool execution with user approval flow
- Session/thread management grouped by project
- Code block rendering with syntax highlighting
- Mobile-responsive layout
- Session authentication with HttpOnly cookies

## License

MIT
