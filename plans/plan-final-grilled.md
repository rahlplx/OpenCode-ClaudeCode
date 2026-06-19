# Final Grilled Plan: Multi-Tenant LLM-Agnostic BYOK Platform

Stress-tested by 8 personas. No UI/UX changes — responsive CSS only.

---

## Locked Decisions

| Decision | Value | Rationale |
|----------|-------|-----------|
| Frontend framework | **Vue 3 — no changes** | User directive: no UI/UX changes |
| UI changes scope | **Responsive CSS only** | Device-tailored, not redesigned |
| Backend architecture | **Express 5 bridge** | Proven, working |
| Multi-tenancy | **Required** | Systematic user isolation |
| LLM provider model | **Agnostic — any provider** | Not locked to Zen/OpenRouter |
| Key management | **BYOK** | Users bring their own API keys |
| Free tier | **Keep as default fallback** | Zen + OpenRouter :free still available |

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

## PART 3: Responsive CSS (No UI/UX Changes)

### What Changes

**ONLY CSS classes and Tailwind responsive prefixes.** No new components, no layout restructuring, no new UI patterns.

| File | Change Type | What |
|------|-------------|------|
| MainLayout.vue | CSS only | Add `hidden md:flex` to sidebar container, `flex md:hidden` to mobile menu button |
| Sidebar.vue | CSS only | Add `fixed inset-0 z-50 md:relative` for drawer mode on mobile |
| ChatPanel.vue | CSS only | Add `h-[100dvh]`, safe-area padding, larger tap targets |
| ChatMessage.vue | CSS only | Add `max-w-[92%] md:max-w-[80%]`, touch scroll on code blocks |
| style.css | CSS only | Add `@media` for reduced motion, safe-area-insets |

### What Does NOT Change

- No new Vue components
- No component extraction (ChatInput, ChatNavbar, etc.)
- No layout restructuring
- No swipe gesture handlers
- No new JavaScript logic
- No visual redesign

### Responsive Classes to Add

```vue
<!-- MainLayout.vue: sidebar visibility -->
<aside class="w-64 hidden md:flex flex-col">  <!-- was: "w-64 flex flex-col" -->

<!-- MainLayout.vue: mobile menu button -->
<button class="flex md:hidden p-2">☰</button>  <!-- new: toggle sidebar visibility -->

<!-- Sidebar.vue: mobile drawer -->
<div class="fixed inset-0 z-50 md:relative md:inset-auto"
     v-if="!collapsed || isMobileOpen">

<!-- ChatMessage.vue: responsive max-width -->
<div class="max-w-[92%] sm:max-w-[85%] md:max-w-[80%]">  <!-- was: max-w-[80%] -->

<!-- ChatMessage.vue: code blocks -->
<pre class="overflow-x-auto [-webkit-overflow-scrolling:touch]">

<!-- ChatPanel.vue: input area -->
<div class="pb-[env(safe-area-inset-bottom)]">
<textarea class="min-h-[44px] text-base">  <!-- 16px prevents iOS zoom -->

<!-- style.css -->
@media (prefers-reduced-motion: reduce) {
  * { transition-duration: 0.01ms !important; }
}
```

### Mobile Sidebar Toggle (Minimal JS)

One reactive boolean — `isMobileOpen` — controls sidebar visibility on mobile. No new component.

```typescript
// In useAgentState.ts — add one ref
const isMobileOpen = ref(false);
function toggleMobileSidebar() { isMobileOpen.value = !isMobileOpen.value; }
```

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

## PART 6: Implementation Phases (Revised)

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
- `src/composables/useAgentState.ts` — Filter notifications by known sessions

### Phase 4: Circuit Breaker + Failover (1 day)

**Files changed**:
- `src/server/proxy.ts` — Circuit breaker state machine, auto-failover chain
- `src/server/index.ts` — Failover chain configuration per user

### Phase 5: Responsive CSS (0.5 days)

**Files changed**:
- `src/components/layout/MainLayout.vue` — Responsive sidebar visibility
- `src/components/sidebar/Sidebar.vue` — Mobile drawer positioning
- `src/components/chat/ChatPanel.vue` — Safe area, tap targets, dvh
- `src/components/chat/ChatMessage.vue` — Responsive max-width, code scroll
- `src/style.css` — Reduced motion, safe-area-insets
- `src/composables/useAgentState.ts` — Add `isMobileOpen` ref

### Phase 6: Security Hardening (1 day)

**Files changed**:
- `src/server/index.ts` — CORS, rate limiting, security headers, WS auth
- `src/server/proxy.ts` — URL validation, response sanitization, error sanitization

### Phase 7: Tests (2 days)

**Files new**:
- `tests/proxy.test.ts` — Protocol translation, failover, circuit breaker
- `tests/auth.test.ts` — Session management, multi-user isolation
- `tests/keys.test.ts` — BYOK encryption/decryption
- `tests/providers.test.ts` — Provider registry, preset loading

**Total effort**: ~9.5 days

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

### Responsive CSS

- [ ] App loads without horizontal scroll on 320px viewport
- [ ] Sidebar hidden on mobile, shown via menu button
- [ ] Chat messages use 92% width on mobile, 80% on desktop
- [ ] Input tap target is 44px+ height
- [ ] Safe area insets respected on notch phones
- [ ] Reduced motion preference honored
- [ ] No new Vue components created
- [ ] No layout restructuring

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
| CSS-only responsive insufficient | Medium | Medium | If needed, add minimal JS (one boolean). No component restructuring |
| Free tier rate limits hit frequently | High | Medium | Queue messages, surface clear wait time to user |
| User configures invalid provider URL | Medium | Low | URL validation on registration, test endpoint |
| Server restart loses BYOK keys | High | High | MVP: accept. Production: persistent storage |

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Keep Vue 3 | User directive: no UI/UX changes |
| CSS-only responsive | Minimal change surface, no risk of breaking existing UI |
| Dynamic provider registry over enum | Extensible to any provider without code changes |
| AES-256-GCM for BYOK keys | Native Node.js crypto, no new dependencies |
| In-memory key storage for MVP | Simplicity. Persistent storage = Phase 2 |
| Circuit breaker per provider per user | Prevents one user's provider failure from affecting others |
| No new Vue components | User directive: no UI/UX changes |
| Anthropic Messages adapter | Only non-OpenAI-compatible major provider |
| Provider presets over discovery | Faster setup, known-good configs |
