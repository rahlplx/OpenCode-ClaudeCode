# OpenCode-ClaudeCode: Project Specification

## Executive Summary

OpenCode-ClaudeCode is an AI coding agent that combines **OpenCode's free LLM infrastructure** (Zen API + OpenRouter free models) with a **Claude Code-inspired web UI**. It enables developers to get a full-featured AI coding assistant experience with zero API costs by leveraging OpenCode as the backend provider.

The architecture follows the proven three-tier bridge pattern pioneered by codex-mobile: a Vue 3 SPA communicates with a Node.js Express bridge server, which manages an OpenCode child process and provider proxy layer.

---

## 1. Architecture

### 1.1 Three-Tier Design

```
┌─────────────────────────────────────────────────────┐
│  BROWSER LAYER (Vue 3 SPA)                          │
│  ┌─────────┐ ┌──────────┐ ┌───────────┐            │
│  │ Chat UI │ │ Sidebar  │ │ Terminal  │            │
│  │ Panel   │ │ Threads  │ │ Output   │            │
│  └────┬────┘ └────┬─────┘ └─────┬─────┘            │
│       └───────────┴─────────────┘                   │
│                    │ HTTP POST / WebSocket           │
└────────────────────┼────────────────────────────────┘
                     │
┌────────────────────┼────────────────────────────────┐
│  BRIDGE LAYER (Express 5 + Node.js)                 │
│  ┌─────────────────┴──────────────────┐             │
│  │  /api/rpc          → JSON-RPC proxy │             │
│  │  /api/ws           → WebSocket hub  │             │
│  │  /api/events       → SSE fallback   │             │
│  │  /api/proxy/*      → Provider proxy │             │
│  │  /api/files/*      → File server    │             │
│  └─────────────────┬──────────────────┘             │
│                    │ stdin/stdout JSON-RPC 2.0       │
└────────────────────┼────────────────────────────────┘
                     │
┌────────────────────┼────────────────────────────────┐
│  BACKEND LAYER                                      │
│  ┌─────────────────┴──────────────────┐             │
│  │  OpenCode Process                   │             │
│  │  (spawned via @opencode-ai/sdk)     │             │
│  │  - Session management               │             │
│  │  - Tool execution                   │             │
│  │  - File operations                  │             │
│  │  - Code analysis                    │             │
│  └─────────────────┬──────────────────┘             │
│                    │                                 │
│  ┌─────────────────┴──────────────────┐             │
│  │  Provider Proxy Layer               │             │
│  │  ┌──────────┐ ┌────────┐ ┌──────┐  │             │
│  │  │OpenRouter│ │Zen API │ │Custom│  │             │
│  │  │(free)    │ │(free)  │ │      │  │             │
│  │  └──────────┘ └────────┘ └──────┘  │             │
│  └────────────────────────────────────┘             │
└─────────────────────────────────────────────────────┘
```

### 1.2 Key Design Decisions (Mined from codex-mobile)

| Decision | Rationale |
|----------|-----------|
| Single composable for state | ~2000 LOC in one file trades modularity for discoverability |
| WebSocket primary, SSE fallback | Real-time notifications with graceful degradation |
| Optimistic threading | Immediate UI response before server confirmation |
| Debounced event sync (220ms) | Balance responsiveness vs network saturation |
| Context-scoped preferences | Per-thread model/mode selection |
| Two-token auth system | Placeholder tokens to frontend, real keys in bridge |
| Protocol translation | Responses API ↔ Chat Completions API bidirectional |

---

## 2. Free Token Strategy

### 2.1 Provider Hierarchy

1. **OpenCode Zen API** (Primary)
   - Endpoint: `https://opencode.ai/zen/v1`
   - Uses OpenCode's built-in free tier
   - Supports both Responses and Chat Completions wire formats
   - Public fallback token available for unauthenticated requests

2. **OpenRouter Free Models** (Secondary)
   - Endpoint: `https://openrouter.ai/api/v1`
   - Filter models ending in `:free` or matching `openrouter/free`
   - Fallback models: Gemma, Llama 3.3, Qwen variants
   - 10-minute model list cache

3. **Custom Endpoint** (User-configurable)
   - Any OpenAI-compatible API
   - User provides their own API key

### 2.2 Token Management

```
Browser → Placeholder Token → Bridge Server → Real API Key → Provider
```

- Frontend receives provider-specific placeholder tokens (e.g., "zen-proxy-token")
- Bridge server reads real API keys from config (`~/.opencode-claudecode/providers.json`)
- Real keys never exposed to browser
- Key rotation support via encrypted key pool (XOR encryption with known secret)

### 2.3 Free Model Discovery

```typescript
// Auto-discover free models from OpenRouter
async function discoverFreeModels(): Promise<Model[]> {
  const models = await fetch('https://openrouter.ai/api/v1/models');
  return models.filter(m => m.id.endsWith(':free') || m.id.includes('free'));
}
```

---

## 3. Feature Specification

### 3.1 Core Features (Phase 1 — MVP)

| Feature | Description |
|---------|-------------|
| **Chat Interface** | Send prompts, receive streaming AI responses |
| **Thread Management** | Create, list, archive, select conversation threads |
| **Model Selection** | Choose from available free models per thread |
| **Streaming Responses** | Real-time token streaming via WebSocket/SSE |
| **File Context** | Attach files/folders as context for the AI |
| **Tool Execution** | AI can read/write files, run commands (with approval) |
| **Server Requests** | Approve/deny AI-initiated actions (file edits, commands) |
| **Code Display** | Syntax-highlighted code blocks with copy/apply actions |
| **Mobile Responsive** | Full mobile browser support with drawer sidebar |

### 3.2 Enhanced Features (Phase 2)

| Feature | Description |
|---------|-------------|
| **Provider Switching** | Switch between Zen/OpenRouter/Custom mid-session |
| **Project Management** | Group threads by project, rename, reorder |
| **Voice Input** | Hold-to-dictate with transcription |
| **Terminal Output** | Display command execution results inline |
| **Diff Viewer** | Show file changes with accept/reject controls |
| **Thread Forking** | Branch conversations without modifying originals |
| **Export/Import** | ZIP project export with embedded chat history |

### 3.3 Advanced Features (Phase 3)

| Feature | Description |
|---------|-------------|
| **Remote Tunneling** | Cloudflare tunnel with QR code access |
| **Multi-Agent** | Plan/Build/General agent modes |
| **MCP Integration** | Model Context Protocol server support |
| **Rate Limit Dashboard** | Visual display of remaining free tokens |
| **Auto-Retry** | Automatic model fallback on rate limits |
| **Collaboration** | Shared sessions via tunnel |

---

## 4. Data Flow

### 4.1 Message Lifecycle

```
User types message
  → UI creates optimistic thread (immediate feedback)
  → HTTP POST /api/rpc { method: "session.create" | "session.chat" }
  → Bridge validates & forwards to OpenCode process
  → OpenCode selects provider via proxy layer
  → Provider returns streaming response
  → Bridge forwards SSE chunks via WebSocket
  → UI applies real-time deltas to message display
  → On completion: reconcile optimistic state with server truth
```

### 4.2 Tool Execution Flow

```
AI decides to use tool (e.g., file_write)
  → OpenCode sends server_request notification
  → Bridge forwards to UI via WebSocket
  → UI displays approval dialog
  → User approves/denies
  → Response sent back through bridge to OpenCode
  → OpenCode executes tool and continues generation
```

### 4.3 Provider Fallback Flow

```
Request to primary provider (Zen)
  → If 429 (rate limited) or 503 (unavailable)
  → Auto-switch to secondary provider (OpenRouter free)
  → If also limited, try next free model in pool
  → If all exhausted, show rate limit UI with countdown
```

---

## 5. API Specification

### 5.1 Bridge HTTP Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/rpc` | JSON-RPC 2.0 proxy to OpenCode |
| GET/WS | `/api/ws` | WebSocket notification stream |
| GET | `/api/events` | SSE fallback for notifications |
| POST | `/api/proxy/zen/v1/responses` | Zen provider proxy |
| POST | `/api/proxy/openrouter/v1/responses` | OpenRouter proxy |
| POST | `/api/proxy/custom/v1/responses` | Custom endpoint proxy |
| GET | `/api/files/:path` | Serve local files |
| GET | `/api/models` | List available free models |
| POST | `/api/auth/login` | Session authentication |
| GET | `/api/health` | Server health check |

### 5.2 WebSocket Notification Types

| Event | Payload | Purpose |
|-------|---------|---------|
| `session.created` | `{ sessionId }` | New session started |
| `message.delta` | `{ text, sessionId }` | Streaming text chunk |
| `message.complete` | `{ message, sessionId }` | Full message received |
| `tool.request` | `{ tool, args, requestId }` | Tool approval needed |
| `tool.result` | `{ result, requestId }` | Tool execution result |
| `error` | `{ code, message }` | Error notification |
| `rate_limit` | `{ provider, retryAfter }` | Rate limit hit |

### 5.3 JSON-RPC Methods (OpenCode SDK)

| Method | Purpose |
|--------|---------|
| `session.create` | Create new coding session |
| `session.list` | List all sessions |
| `session.chat` | Send message in session |
| `session.abort` | Cancel in-progress generation |
| `model.list` | Get available models |
| `config.read` | Read configuration |
| `config.write` | Update configuration |

---

## 6. Technology Stack

### 6.1 Frontend

| Technology | Version | Purpose |
|------------|---------|---------|
| Vue 3 | ^3.5 | UI framework (Composition API) |
| Vue Router 4 | ^4.6 | Client-side routing |
| TypeScript 5 | ^5.7 | Type safety |
| Tailwind CSS 4 | ^4.1 | Utility-first styling |
| Vite 6 | ^6.1 | Dev server & bundler |
| xterm.js | ^6.0 | Terminal emulator widget |
| highlight.js | latest | Code syntax highlighting |
| markdown-it | latest | Markdown rendering |

### 6.2 Backend

| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | >= 18 | Runtime |
| Express 5 | ^5.1 | HTTP server |
| @opencode-ai/sdk | latest | OpenCode integration |
| ws | ^8.18 | WebSocket server |
| Commander 13 | ^13.1 | CLI framework |
| tsup 8 | ^8.4 | CLI bundler |

### 6.3 Development

| Technology | Purpose |
|------------|---------|
| Vitest | Unit testing |
| Playwright | E2E testing |
| ESLint + oxlint | Linting |
| pnpm | Package management |

---

## 7. State Management

### 7.1 Composable Architecture

All frontend state lives in a single composable (`useAgentState`), following the codex-mobile pattern:

```typescript
// Core state shape
interface AgentState {
  // Sessions
  sessions: Map<string, Session>
  selectedSessionId: Ref<string | null>

  // Messages
  persistedMessages: Map<string, Message[]>
  liveStreamMessages: Map<string, Message[]>

  // Models
  availableModels: Ref<Model[]>
  selectedModelBySession: Map<string, string>

  // Provider
  activeProvider: Ref<'zen' | 'openrouter' | 'custom'>
  providerStatus: Ref<ProviderStatus>

  // UI
  sidebarCollapsed: Ref<boolean>
  pendingApprovals: Ref<ServerRequest[]>
}
```

### 7.2 localStorage Persistence

| Key | Purpose |
|-----|---------|
| `occ.selected-session` | Last active session |
| `occ.sidebar-collapsed` | Sidebar state |
| `occ.model-preferences` | Per-session model choices |
| `occ.provider-config` | Active provider settings |
| `occ.scroll-positions` | Per-session scroll memory |

---

## 8. Security

- Real API keys never leave the bridge server
- Placeholder tokens used in frontend ↔ bridge communication
- HttpOnly session cookies with constant-time comparison
- Auto-generated passwords in production mode
- File serving restricted to project directories
- Tool execution requires explicit user approval
- No eval() or dynamic code execution from AI responses

---

## 9. Implementation Phases

### Phase 1: Foundation (MVP) — Weeks 1-2
1. Project scaffolding (Vite + Vue 3 + Express + TypeScript)
2. OpenCode SDK integration (spawn + manage process)
3. JSON-RPC bridge server
4. WebSocket notification hub
5. Basic chat UI (send/receive messages)
6. Provider proxy layer (Zen + OpenRouter free)
7. Session management (create, list, select)
8. Streaming response display

### Phase 2: Core Agent Features — Weeks 3-4
9. Tool execution with approval flow
10. File context and project awareness
11. Code block rendering with syntax highlighting
12. Diff viewer for file changes
13. Terminal output display
14. Model selection per session
15. Provider switching and fallback
16. Mobile responsive layout

### Phase 3: Polish & Advanced — Weeks 5-6
17. Thread forking
18. Voice input
19. Export/import projects
20. Remote tunneling
21. Rate limit dashboard
22. Multi-agent modes (plan/build/general)
23. MCP server integration
24. E2E tests with Playwright

---

## 10. Key Learnings from codex-mobile

### What Works
- **Single composable pattern**: Despite being ~2000 LOC, having all state in one place makes the entire data flow discoverable and debuggable
- **Optimistic UI**: Creating threads/messages immediately before server confirms makes the UI feel instant
- **Protocol translation**: The unified proxy that converts between Responses ↔ Chat Completions API means any provider works
- **Debounced sync**: 220ms debounce on notification-driven state refresh prevents UI thrashing during rapid streaming
- **Two-token auth**: Never exposing real API keys to the browser is simple and effective

### What to Improve
- **Better modularity**: Split the mega-composable into sub-composables that compose together
- **Typed RPC**: Generate TypeScript types from OpenCode's API schema instead of manual DTOs
- **Error boundaries**: More granular error handling per component rather than global catch
- **Offline resilience**: Queue messages when connection drops, replay on reconnect
- **Test coverage**: Unit tests for protocol translation logic, E2E for critical flows
