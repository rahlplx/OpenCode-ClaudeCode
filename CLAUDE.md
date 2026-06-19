# OpenCode-ClaudeCode

AI Coding Agent that uses OpenCode as the LLM backend (free token access via OpenCode Zen + OpenRouter free models) with a Claude Code-style web UI.

## Project Overview

This project bridges OpenCode's free AI infrastructure with a browser-based coding agent UI inspired by Claude Code's web interface. The architecture follows the proven codex-mobile pattern: a Vue 3 SPA communicating with a Node.js Express bridge server that proxies requests to an OpenCode backend process.

## Architecture

```
Browser (Vue 3 SPA) → Express Bridge Server → OpenCode Process (via @opencode-ai/sdk)
                                             → Provider Proxy Layer → OpenRouter / OpenCode Zen / Custom
```

## Tech Stack

- **Frontend**: Vue 3 (Composition API), TypeScript, Tailwind CSS 4, Vite 6
- **Backend**: Node.js 18+, Express 5, TypeScript
- **AI Backend**: OpenCode SDK (`@opencode-ai/sdk`), spawned as child process
- **Build**: Vite (frontend), tsup (CLI/server), Vitest (tests)
- **Package Manager**: pnpm

## Key Commands

```bash
pnpm install          # Install dependencies
pnpm dev              # Start dev server (frontend + bridge)
pnpm build            # Build production bundle
pnpm build:cli        # Build CLI entry point
pnpm test             # Run tests
pnpm lint             # Lint code
pnpm typecheck        # Type check
```

## Directory Structure

```
src/
├── api/              # Frontend API gateway (RPC client, DTOs)
├── cli/              # CLI entry point (Commander)
├── components/       # Vue components
│   ├── chat/         # Chat interface components
│   ├── sidebar/      # Thread/project sidebar
│   └── layout/       # Page layout
├── composables/      # Vue composables (state management)
├── providers/        # LLM provider proxy implementations
├── server/           # Express bridge server
│   ├── bridge.ts     # OpenCode process manager
│   ├── proxy.ts      # Unified provider proxy
│   └── auth.ts       # Session authentication
├── types/            # TypeScript type definitions
├── utils/            # Shared utilities
├── router/           # Vue Router config
├── App.vue           # Root component
├── main.ts           # Frontend entry
└── style.css         # Global styles
```

## Development Guidelines

- Single composable pattern for state management (no Vuex/Pinia)
- JSON-RPC 2.0 for bridge-to-backend communication
- WebSocket primary, SSE fallback for real-time notifications
- Optimistic UI with server reconciliation
- Context-scoped preferences (per-thread model selection)
- Debounced event sync (220ms) to prevent UI thrashing
