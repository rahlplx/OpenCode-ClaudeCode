# Final Grilled Plan: Multi-Tenant LLM-Agnostic BYOK Platform

Stress-tested by 8 personas. Kanna (React + Zustand) as web UI, made responsive.

---

## Locked Decisions

| Decision | Value | Rationale |
|----------|-------|-----------|
| Frontend framework | **Kanna (React + Zustand)** | Direct code reuse from reference project, same ecosystem |
| UI changes scope | **Responsive for mobile/tablet/desktop** | Screen-size agnostic, device-tailored |
| Backend architecture | **Express 5 bridge** | Proven, working — unchanged |
| Multi-tenancy | **Required** | Systematic user isolation |
| LLM provider model | **Agnostic — any provider** | Not locked to Zen/OpenRouter |
| Key management | **BYOK** | Users bring their own API keys |
| Free tier | **Keep as default fallback** | Zen + OpenRouter :free still available |

## PIVOT: Vue 3 → Kanna (React + Zustand)

### What changes
- **Delete**: `src/components/`, `src/composables/`, `src/router/`, `src/App.vue`, `src/main.ts`
- **Keep**: `src/server/`, `src/providers/`, `src/cli/`, `src/types/`, `src/api/`
- **Add**: Kanna React frontend (clone + adapt to our backend API)
- **Replace deps**: vue, vue-router → react, react-dom, zustand, react-router, react-resizable-panels

### What stays the same
- Express 5 bridge server (proxy.ts, bridge.ts, auth.ts, index.ts)
- Provider proxy (Zen, OpenRouter, BYOK dynamic)
- CLI entry point
- WebSocket notifications
- Build: Vite (supports React via @vitejs/plugin-react)

### Why Kanna over Vue 3
- Kanna already has: resizable panels, mobile sidebar drawer, terminal workspace, responsive breakpoints
- Same framework = direct component/hook/store reuse
- 2000 LOC Vue rewrite vs ongoing translation cost of every Kanna pattern

---

## PART 1: LLM-Agnostic + BYOK Architecture

### Current State (Hardcoded 3 Providers)

```typescript
// types/index.ts — hardcoded union
type ProviderType = "zen" | "openrouter" | "custom";

// server/index.ts — hardcoded provider config
const proxyConfig = {
  providers: {
    zen: { chatUrl: "https://opencode.ai/zen/v1/...", ... },
    openrouter: { chatUrl: "https://openrouter.ai/api/v1/...", ... },
    custom: { chatUrl: "", apiKey: undefined, ... },  // Empty!
  }
};
```

### Target State (Dynamic Provider Registry)

```typescript
// types/index.ts — dynamic provider, not a union
interface ProviderConfig {
  id: string;                        // "openai", "anthropic", "groq", user-defined
  name: string;                      // Display name
  baseUrl: string;                   // API base (e.g., "https://api.openai.com/v1")
  wireApi: "chat" | "responses";     // Protocol format
  apiKey?: string;                   // BYOK: user's key (stored encrypted)
  models?: string[];                 // Available models for this provider
  isFree?: boolean;                  // Free tier flag
  headers?: Record<string, string>;  // Custom headers
  maxTokens?: number;                // Provider-specific limits
  rateLimit?: { rpm: number; rpd: number }; // Rate limits
}

// Provider registry — built-in + user-defined
interface ProviderRegistry {
  builtIn: ProviderConfig[];         // Zen, OpenRouter (free defaults)
  userDefined: ProviderConfig[];     // BYOK providers per user
}
```

### Built-In Provider Presets

Users select from presets or define custom. No API key = free tier only.

| Provider | Base URL | Wire API | Free? | Notes |
|----------|----------|----------|-------|-------|
| OpenCode Zen | opencode.ai/zen/v1 | chat | Yes | Default, public token |
| OpenRouter Free | openrouter.ai/api/v1 | responses | Yes | :free models auto-discovered |
| OpenAI | api.openai.com/v1 | chat | BYOK | GPT-4o, o3, etc. |
| Anthropic | api.anthropic.com/v1 | messages* | BYOK | Claude family |
| Google AI | generativelanguage.googleapis.com | chat | BYOK | Gemini family |
| Groq | api.groq.com/openai/v1 | chat | BYOK | Fast inference |
| Together AI | api.together.xyz/v1 | chat | BYOK | Open-source models |
| Ollama | localhost:11434/v1 | chat | Local | Self-hosted |
| Custom | user-defined | chat/responses | BYOK | Any OpenAI-compatible endpoint |

*Anthropic uses Messages API — proxy needs a `messages` wire format adapter.

### BYOK Key Storage

**Server-side only** — keys never sent to browser.

```typescript
// Per-user key storage (in-memory for MVP, database for production)
interface UserKeys {
  userId: string;
  keys: Map<string, string>;  // providerId → encrypted API key
}

// Keys encrypted at rest with server-side secret
const ENCRYPTION_KEY = process.env.OCC_ENCRYPTION_KEY || randomBytes(32);

function encryptKey(apiKey: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}
```

### API Endpoints for BYOK

```
POST /api/providers                    — Register a provider (preset or custom)
GET  /api/providers                    — List user's configured providers
PUT  /api/providers/:id/key            — Set/update API key for provider
DELETE /api/providers/:id              — Remove provider
GET  /api/providers/:id/models         — List models for provider
POST /api/providers/:id/test           — Test connectivity with stored key
POST /api/proxy/:providerId/v1/responses  — Existing proxy (now dynamic)
```

### Failover Chain (User-Configurable)

Default: `Zen (free) → OpenRouter :free → User's BYOK providers (by priority)`

Users can reorder via UI. Each provider has a circuit breaker.

```typescript
interface FailoverChain {
  userId: string;
  providers: string[];  // Ordered list of provider IDs
  activeIndex: number;
  circuitBreakers: Map<string, CircuitBreaker>;
}

interface CircuitBreaker {
  providerId: string;
  failureCount: number;
  lastFailure: number;
  state: "closed" | "open" | "half-open";
  openUntil: number;  // Timestamp when to retry
}
```

### Wire API Adapters

The proxy already handles `chat` and `responses` formats. For full LLM-agnostic support, add:

| Wire API | Providers | Adapter Needed |
|----------|-----------|---------------|
| `chat` (OpenAI Chat Completions) | OpenAI, Groq, Together, Ollama, Zen | Existing ✓ |
| `responses` (OpenAI Responses) | OpenRouter, OpenAI (new) | Existing ✓ |
| `messages` (Anthropic Messages) | Anthropic | **NEW** — convert chat → Messages API format |

Anthropic Messages adapter:
```typescript
function chatToAnthropicMessages(req: ChatCompletionsRequest): AnthropicRequest {
  const system = req.messages.filter(m => m.role === "system").map(m => m.content).join("\n");
  const messages = req.messages.filter(m => m.role !== "system").map(m => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));
  return { model: req.model, system, messages, max_tokens: req.max_tokens || 4096 };
}
```

---

## PART 2: Multi-Tenant Isolation (from plan-multi-tenant.md)

### Summary of Changes

| Component | Current | Target |
|-----------|---------|--------|
| Auth | Token only, no userId | Token + userId + per-user passwords |
| WebSocket | Broadcast to ALL | Per-user routing |
| Sessions | Unscoped | userId ownership tracking |
| Tool requests | No validation | Ownership check |
| Provider keys | Global config | Per-user BYOK storage |
| Rate limits | Global | Per-user buckets |
| localStorage | Global `occ.*` | Scoped `occ.{userId}.*` |

### Implementation (see plan-multi-tenant.md for full details)

Phase 0: User identity foundation (0.5 days)
Phase 1: WebSocket isolation (0.5 days)
Phase 2: API scoping (1 day)
Phase 3: Frontend defense-in-depth (0.5 days)
Phase 4: Multi-user auth with registration (1 day)

---

## PART 3: Responsive UI via Kanna

### Kanna Already Has (From Research)

- **Resizable panels** via `react-resizable-panels` (sidebar, chat, terminal splits)
- **Mobile sidebar drawer** — `fixed inset-0 z-50` overlay with backdrop blur on <768px
- **Right sidebar** — `absolute inset-y-0 right-0` slide-in for Git/browser panels on mobile
- **Safe-area-insets** — `pt-[max(env(safe-area-inset-top),0px)]` for notch phones
- **Touch-friendly** — `WebkitOverflowScrolling: "touch"`, `touchAction: "pan-y"`
- **100dvh** layout — uses dynamic viewport height
- **Breakpoint** at `md:` (768px) for mobile/desktop split

### What We Add for Full Device Coverage

| Device | Width | Kanna Default | Our Enhancement |
|--------|-------|---------------|-----------------|
| Phone portrait | 320-480px | Sidebar drawer, single panel | Verify touch targets 44px+, test virtual keyboard |
| Phone landscape | 568-926px | Works via flexbox | Validate no overflow, test with notch |
| Tablet portrait | 768-1024px | Desktop mode kicks in | Verify sidebar width appropriate |
| Tablet landscape | 1024-1366px | Full desktop | Add optional split terminal view |
| Desktop | 1280px+ | Full layout with resizable panels | Confirm all resize handles work |
| Ultrawide | 2560px+ | Stretches | Add max-width container or 3-column layout |

### Kanna Responsive Patterns to Preserve

```tsx
// KannaSidebar.tsx — mobile drawer pattern
<div className="fixed inset-0 z-50 md:relative md:inset-auto">
  <div className="md:h-[calc(100dvh-16px)] md:my-2 md:ml-2 md:border md:rounded-2xl">

// ChatPage — mobile right sidebar overlay
const MOBILE_RIGHT_SIDEBAR_BREAKPOINT_PX = 768;
<div className="absolute inset-y-0 right-0 w-[min(92vw,30rem)]
               transition-transform duration-300">

// Safe areas for notch phones
<div className="pt-[max(env(safe-area-inset-top),0px)]
               pb-[max(env(safe-area-inset-bottom),0px)]">
```

### Our Additions

1. **Test all breakpoints** — 320px, 768px, 1024px, 1280px, 2560px
2. **Font size 16px on inputs** — prevent iOS auto-zoom
3. **Reduced motion support** — `@media (prefers-reduced-motion: reduce)`
4. **Dark/light theme** — Kanna has CSS variables, ensure both work on all sizes
5. **PWA manifest** (Phase 2) — `display: standalone` for mobile app feel

---

## PART 4: Harness Results + Gaps

### Vibe-Stack Harness: 10/15 passed

| Check | Status | Impact on Our Project |
|-------|--------|----------------------|
| test-suite | FAIL | Our project has 0 tests — need test coverage |
| eslint-lint-pass | FAIL | ESLint not configured for our project |
| catalog-yaml-valid | FAIL | vibe-stack internal (not our code) |
| catalog-category-count | FAIL | vibe-stack internal |
| index-json-integrity | FAIL | vibe-stack internal |
| handoff-templates | PASS | — |
| phase-gates-doc | PASS | — |
| skill-originality | PASS | — |
| security-scan | PASS | 0 critical in skill files |
| node-test-suite | PASS | 148 passed (vibe-stack's own tests) |
| quality-scores | PASS | 0 grade-D tools |
| spec-gates | PASS | 14 gates met |
| state-machine-valid | PASS | Pipeline valid |

### Our Project's Harness Gaps

| Gap | Severity | Fix |
|-----|----------|-----|
| Zero test files | HIGH | Add vitest tests for proxy, auth, providers |
| No ESLint config | MEDIUM | Add eslint.config.js with TypeScript rules |
| No CI pipeline | MEDIUM | Add GitHub Actions for test + lint + typecheck |
| xterm dead dependency | LOW | Remove from package.json |
| @opencode-ai/sdk unpinned | MEDIUM | Pin to specific version |

---

## PART 5: Grilled by 8 Personas

### 1. CEO — Business Viability

**Q: Is LLM-agnostic BYOK the right scope?**
YES. The market is moving to multi-provider. Users want to use Claude for coding, GPT for planning, Llama for privacy. Locking to one provider = losing users. BYOK removes the "who pays for tokens" question.

**Q: Will multi-tenant add too much complexity?**
No — the isolation changes are mechanical (scope by userId). The current code already has all the right endpoints; they just lack access control. ~3 days.

**Risk**: Feature creep into provider-specific features (Claude artifacts, GPT canvas, etc.). **Mitigation**: Stick to chat completions + tool use as the universal interface. Provider-specific features = Phase N+1.

### 2. Architect — Technical Soundness

**Q: Can the proxy handle arbitrary providers without growing N adapters?**
YES — 95% of LLM providers use OpenAI-compatible Chat Completions API. The existing `chat` wire format handles them all. Only Anthropic needs a dedicated `messages` adapter. Google's `generateContent` can also route through an OpenAI-compatible wrapper.

**Q: How does BYOK key rotation work?**
PUT `/api/providers/:id/key` with new key. Old key overwritten. No key versioning needed — keys are stateless credentials.

**Q: What about providers that need custom auth headers?**
`ProviderConfig.headers` allows arbitrary custom headers. The `buildHeaders` function pattern already supports this.

**Hole found**: Streaming abort across providers — when user aborts, we close the upstream connection. Some providers don't cleanly support abort. **Mitigation**: Best-effort close + timeout; document provider-specific behavior.

### 3. Security Engineer — BYOK Key Safety

**Q: Where are user API keys stored?**
In-memory encrypted Map for MVP. Never in localStorage, never in browser, never in logs. AES-256-GCM with server-side key from env var.

**Q: What if the server encryption key leaks?**
All stored API keys compromised. **Mitigation**: 
- Key rotation mechanism (re-encrypt all keys with new master key)
- For production: use a KMS (AWS KMS, Vault) instead of env var
- Keys never logged, never in error messages, never in responses

**Q: Can one user's BYOK key be used by another user?**
No — keys stored in per-user Map, scoped by userId. API layer validates userId before retrieving keys.

**Q: Provider URL validation against SSRF?**
Validate URLs on registration: must be HTTPS (except localhost for Ollama), block private IPs, block AWS metadata endpoint (169.254.169.254).

### 4. Mobile UX Specialist — Responsive CSS

**Q: Will CSS-only responsive changes actually work?**
YES for this app. The layout is simple: sidebar + chat. Tailwind's `hidden md:flex` and `fixed inset-0 z-50` patterns handle sidebar drawer with zero JS (except one boolean toggle). No ResizablePanelGroup needed.

**Q: What about virtual keyboard?**
`h-[100dvh]` handles dynamic viewport height. `text-base` (16px) prevents iOS auto-zoom on focus. `pb-[env(safe-area-inset-bottom)]` handles home indicator. These are CSS-only.

**Q: What about landscape mode on phones?**
Flexbox handles it naturally — sidebar drawer covers full screen, chat fills available space. No special handling needed.

### 5. QA Tester — Multi-Tenant Edge Cases

**Q: What happens if User A and User B use the same BYOK key?**
Nothing wrong — each user stores their own copy. Rate limits from the provider apply to the key itself, not to our userId.

**Q: What if a user's BYOK key is invalid?**
Provider returns 401/403. We surface "Invalid API key" to the user. Failover chain skips to next provider.

**Q: Concurrent streaming from same user on two tabs?**
Each tab has its own WebSocket connection, both registered to same userId. Both receive notifications. Streaming state is per-session, not per-tab.

**Q: User creates session, logs out, logs back in — does session persist?**
Yes — sessions are stored server-side (in OpenCode bridge). Logging back in retrieves the same session list.

### 6. DevOps Engineer — Build & Deploy

**Q: Does BYOK add new dependencies?**
No — Node.js `crypto` module handles AES-256-GCM encryption natively. No new packages.

**Q: How does deployment change?**
One new env var: `OCC_ENCRYPTION_KEY`. Everything else stays the same. Docker image unchanged.

**Q: What about the dead xterm dependency?**
Remove it. Saves ~50KB. No code uses it.

### 7. Performance Engineer — Provider Proxy Overhead

**Q: Does dynamic provider lookup add latency?**
Negligible — Map lookup is O(1). Provider config is in-memory. Circuit breaker check is O(1).

**Q: What about BYOK key decryption on every request?**
AES-256-GCM decrypt is <1ms. For hot path, can cache decrypted keys in memory per session lifetime.

**Q: Bundle size impact?**
Zero — all changes are server-side. Frontend adds ~20 lines of responsive CSS.

### 8. Accessibility Expert — Responsive Changes

**Q: Does responsive CSS break screen readers?**
No — `hidden md:flex` uses `display: none` which correctly hides from AT. Mobile menu button needs `aria-label="Toggle sidebar"` and `aria-expanded` binding.

**Q: Reduced motion support?**
Added via `@media (prefers-reduced-motion: reduce)` in style.css. Disables transitions.

---

## PART 6: Implementation Phases (Revised — Kanna Pivot)

### Phase 0: Kanna Frontend Integration (3 days)

**Step 1 — Scaffold**:
- Clone Kanna source into `src/client/` (React components, Zustand stores, styles)
- Remove Vue 3 frontend: `src/components/`, `src/composables/`, `src/router/`, `src/App.vue`, `src/main.ts`
- Replace Vite Vue plugin with React plugin: `@vitejs/plugin-react`
- Update `package.json`: swap vue deps → react, zustand, react-router, react-resizable-panels

**Step 2 — Wire to backend**:
- Point Kanna's LLM provider to our Express bridge (`/api/proxy/:provider/v1/responses`)
- Map Kanna's WebSocket commands to our notification protocol
- Wire Kanna's session management to our `/api/rpc` endpoints
- Configure Kanna's `ProviderCatalog` to use our dynamic provider registry

**Step 3 — Responsive verification**:
- Test Kanna's existing responsive patterns on 320px, 768px, 1024px, 1280px, 2560px
- Fix any breakpoint issues for our backend API shape
- Add reduced motion + safe-area-inset enhancements

**Files removed**: `src/components/`, `src/composables/`, `src/router/`, `src/App.vue`, `src/main.ts`, `src/style.css`
**Files added**: `src/client/` (Kanna React source tree)
**Files changed**: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`

### Phase 1: LLM-Agnostic Provider Registry (2 days)

**Files changed**:
- `src/types/index.ts` — Replace `ProviderType` union with dynamic `ProviderConfig`
- `src/server/proxy.ts` — Accept dynamic provider configs, add `messages` wire adapter
- `src/server/index.ts` — Dynamic provider registration endpoints, provider preset list
- `src/providers/` — Keep zen.ts + openrouter.ts as preset factories, add presets for OpenAI/Anthropic/Groq

**Files new**:
- `src/server/providers.ts` — Provider registry (in-memory storage, CRUD operations)

### Phase 2: BYOK Key Management (1 day)

**Files changed**:
- `src/server/index.ts` — Add key management endpoints
- `src/server/proxy.ts` — Resolve API key from user's stored keys

**Files new**:
- `src/server/keys.ts` — Encrypted key storage (AES-256-GCM)

### Phase 3: Multi-Tenant Isolation (2 days)

**Files changed**:
- `src/server/auth.ts` — Add userId to sessions
- `src/server/index.ts` — Per-user WebSocket routing, API scoping
- Kanna Zustand stores — Filter notifications by known sessions, scope localStorage

### Phase 4: Circuit Breaker + Failover (1 day)

**Files changed**:
- `src/server/proxy.ts` — Circuit breaker state machine, auto-failover chain
- `src/server/index.ts` — Failover chain configuration per user

### Phase 5: Security Hardening (1 day)

**Files changed**:
- `src/server/index.ts` — CORS, rate limiting, security headers, WS auth
- `src/server/proxy.ts` — URL validation, response sanitization, error sanitization

### Phase 6: Tests (2 days)

**Files new**:
- `tests/proxy.test.ts` — Protocol translation, failover, circuit breaker
- `tests/auth.test.ts` — Session management, multi-user isolation
- `tests/keys.test.ts` — BYOK encryption/decryption
- `tests/providers.test.ts` — Provider registry, preset loading

**Total effort**: ~12 days (added 3 days for Kanna integration in Phase 0)

---

## PART 7: Acceptance Criteria

### LLM-Agnostic + BYOK

- [ ] User can add any OpenAI-compatible provider via UI settings
- [ ] User can paste their API key — key stored encrypted server-side
- [ ] User can select from preset providers (OpenAI, Anthropic, Groq, etc.)
- [ ] Anthropic Messages API correctly proxied via adapter
- [ ] Free tier (Zen + OpenRouter) works without any API key
- [ ] Provider failover chain is user-configurable
- [ ] Circuit breaker skips failing providers automatically
- [ ] BYOK keys are never sent to browser, never logged

### Multi-Tenant

- [ ] User A cannot see User B's sessions
- [ ] User A cannot receive User B's WebSocket notifications
- [ ] User A cannot approve User B's tool requests
- [ ] User A's BYOK keys are isolated from User B
- [ ] Single-user mode (`--no-password`) still works as before
- [ ] Per-user rate limiting prevents one user monopolizing resources

### Kanna Frontend + Responsive

- [ ] Kanna React frontend builds and runs via Vite
- [ ] Kanna connects to our Express bridge backend (`/api/rpc`, `/api/proxy`)
- [ ] WebSocket notifications flow from bridge to Kanna UI
- [ ] App loads without horizontal scroll on 320px viewport
- [ ] Sidebar drawer works on mobile (<768px)
- [ ] Resizable panels work on desktop (>1024px)
- [ ] Safe area insets respected on notch phones
- [ ] Reduced motion preference honored
- [ ] Input tap targets 44px+ on mobile
- [ ] Virtual keyboard doesn't break layout (dvh, visualViewport)

### Harness

- [ ] `pnpm test` passes with >60% server coverage
- [ ] `pnpm lint` passes (ESLint configured)
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` produces working bundle
- [ ] xterm removed from dependencies
- [ ] @opencode-ai/sdk pinned to specific version

---

## PART 8: Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Anthropic Messages API adapter bugs | Medium | High | Comprehensive test suite, use anthropic-sdk-typescript as reference |
| BYOK key encryption key loss | Low | Critical | Document key backup, support re-registration |
| Provider adds breaking API change | Medium | Medium | Pin provider SDK versions, monitor changelogs |
| Multi-tenant perf overhead | Low | Low | Map lookups are O(1), encryption <1ms |
| Kanna API incompatible with our backend | Medium | High | Map Kanna's WS commands to our JSON-RPC protocol; adapter layer |
| Kanna license restrictions | Low | Critical | Verify MIT/Apache license before integration |
| Free tier rate limits hit frequently | High | Medium | Queue messages, surface clear wait time to user |
| User configures invalid provider URL | Medium | Low | URL validation on registration, test endpoint |
| Server restart loses BYOK keys | High | High | MVP: accept. Production: persistent storage |

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| **Pivot to Kanna (React + Zustand)** | Direct code reuse, same ecosystem as reference, built-in responsive patterns |
| Use Kanna as-is, make responsive | Already has resizable panels, mobile drawer, safe areas — enhance, don't redesign |
| Keep Express 5 backend unchanged | Proven, working — proxy, bridge, auth all stay |
| Dynamic provider registry over enum | Extensible to any provider without code changes |
| AES-256-GCM for BYOK keys | Native Node.js crypto, no new dependencies |
| In-memory key storage for MVP | Simplicity. Persistent storage = Phase 2 |
| Circuit breaker per provider per user | Prevents one user's provider failure from affecting others |
| Anthropic Messages adapter | Only non-OpenAI-compatible major provider |
| Provider presets over discovery | Faster setup, known-good configs |
| Multi-tenant from day 1 | Retrofitting isolation is harder than building it in |
