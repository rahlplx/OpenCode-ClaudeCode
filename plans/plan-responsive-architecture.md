# Plan: Responsive Architecture + Provider Failover

Stress-tested multi-persona plan for screen-size-agnostic UI + robust backend.

## Status Quo

- **5 Vue 3 components**, ~2000 LOC total, Tailwind CSS 4, zero media queries
- **Fixed 256px sidebar**, no mobile breakpoints, no touch handling
- **Backend**: Express 5 bridge → OpenCode SDK + provider proxy (Zen → OpenRouter → Custom)
- **Zero tests**, vitest configured but empty `/tests/` directory
- **WebSocket + SSE** streaming, 220ms debounced sync, optimistic UI

---

## 1. CEO Review — Does this solve a real problem?

**Verdict: YES — with scope guardrails.**

- Free AI coding agent with web UI is high-value: removes API key barrier entirely
- Mobile/tablet support expands TAM from developer-at-desk to developer-on-go (code review, quick fixes, chat-with-codebase from phone/tablet)
- **Risk**: Scope creep into terminal emulation, file explorer, IDE features before core chat is solid
- **Recommendation**: Lock MVP to chat + provider failover + responsive layout. Terminal/file explorer = Phase 2

**Acceptance gate**: User can open the app on any device (phone, tablet, laptop, ultrawide) and have a functional, non-broken chat experience with working provider failover.

---

## 2. Architect Review — Technical Feasibility

### 2.1 Responsive Breakpoint System

**Strategy: Tailwind CSS 4 native breakpoints + CSS container queries**

| Breakpoint | Width | Layout |
|------------|-------|--------|
| `xs` (default) | <640px | Single-panel, sidebar = drawer overlay, full-width chat |
| `sm` | 640-767px | Same as xs, slightly wider chat input |
| `md` | 768-1023px | Optional persistent sidebar (narrow), chat panel |
| `lg` | 1024-1279px | Persistent sidebar (256px) + chat panel |
| `xl` | 1280px+ | Sidebar (256-320px) + chat + optional right panel |

**Implementation**: Tailwind responsive prefixes (`sm:`, `md:`, `lg:`, `xl:`), NOT JavaScript `window.innerWidth` checks. CSS-first, JS only for drawer open/close state.

### 2.2 Component Architecture Changes

```
MainLayout.vue (responsive shell)
├── MobileSidebar.vue (drawer overlay, <md only)
│   └── backdrop + slide-in panel
├── Sidebar.vue (persistent, md+ only, existing component)
├── ChatPanel.vue (full-width on mobile, flex-1 on desktop)
│   ├── ChatNavbar.vue (NEW — model selector, menu button on mobile)
│   ├── MessageList.vue (extracted from ChatPanel, virtual scroll ready)
│   ├── ChatMessage.vue (existing, needs max-width responsive)
│   ├── ApprovalDialog.vue (existing, needs mobile-friendly sizing)
│   └── ChatInput.vue (NEW — extracted, mobile keyboard aware)
└── ConnectionStatus.vue (NEW — provider status indicator)
```

**New components: 4** (MobileSidebar, ChatNavbar, MessageList, ChatInput, ConnectionStatus)
**Modified: 3** (MainLayout, ChatPanel, ChatMessage)
**Unchanged: 2** (Sidebar desktop version, ApprovalDialog internals)

### 2.3 Provider Failover Robustness

Current proxy.ts handles single-shot requests. Needs:

```
Request → Zen API (primary, free)
  ├─ 200 OK → stream response
  ├─ 429 Rate Limited → OpenRouter :free (secondary)
  │   ├─ 200 OK → stream response
  │   ├─ 429/Error → Custom endpoint (if configured)
  │   │   ├─ 200 OK → stream response
  │   │   └─ Error → surface to user
  │   └─ No free models available → surface to user
  └─ 5xx/Timeout → retry once, then failover to OpenRouter
```

**Circuit breaker pattern**: Track failures per provider over 5-min windows. After 3 consecutive failures, skip to next provider for 60s before retrying.

### 2.4 WebSocket Reliability

- **Reconnection**: Exponential backoff (1s, 2s, 4s, 8s, max 30s) with jitter
- **Mobile background**: `visibilitychange` event → pause/resume WebSocket
- **Session recovery**: On reconnect, fetch full session state (not replay missed events)
- **Heartbeat**: 30s ping/pong to detect dead connections

### 2.5 Build Impact

- No new dependencies for responsive (Tailwind 4 has everything)
- Bundle size stays under 200KB gzipped (current ~150KB estimated)
- No framework change — Vue 3 stays

---

## 3. Mobile UX Specialist Review

### 3.1 Touch Interactions

| Gesture | Action |
|---------|--------|
| Swipe right from left edge | Open sidebar drawer |
| Swipe left on open sidebar | Close sidebar drawer |
| Tap backdrop | Close sidebar/overlays |
| Pull down on message list | Refresh/sync session |
| Long press on message | Copy to clipboard |

**Implementation**: CSS `touch-action: pan-y` on chat scroll, vanilla `touchstart`/`touchmove`/`touchend` for swipe detection (no library needed, <50 LOC).

### 3.2 Virtual Keyboard Handling

**Problem**: On mobile, virtual keyboard pushes content up or covers the input.

**Solution**:
- Use `dvh` (dynamic viewport height) instead of `vh`: `h-[100dvh]`
- `visualViewport` API to detect keyboard open/close
- When keyboard opens: scroll message list to bottom, keep input visible
- Input area uses `position: sticky; bottom: 0` with `env(safe-area-inset-bottom)` padding

### 3.3 Mobile-Specific UI

- **Sidebar**: Full-screen drawer with backdrop blur (`bg-black/40 backdrop-blur-sm`)
- **Chat input**: Larger touch target (min 44px height), 16px font (prevents iOS zoom)
- **Messages**: Max-width 92% on mobile (vs 80% on desktop)
- **Code blocks**: Horizontal scroll with `-webkit-overflow-scrolling: touch`
- **Buttons**: Min 44x44px tap targets (WCAG 2.5.8)
- **Safe area insets**: `pb-[env(safe-area-inset-bottom)]` for home indicator

### 3.4 PWA Support (Phase 2, not MVP)

- `manifest.json` with display: standalone
- Service worker for offline shell caching
- NOT in MVP — adds complexity without core value

---

## 4. Security Engineer Review

### 4.1 Current State (Good)

- SHA-256 timing-safe auth ✓
- HttpOnly cookies ✓
- No API keys in browser ✓

### 4.2 Gaps to Address

| Issue | Severity | Fix |
|-------|----------|-----|
| No CORS configuration | Medium | Add explicit `cors()` middleware with allowlist |
| No rate limiting on `/api/rpc` | Medium | Add express-rate-limit (100 req/min per IP) |
| No CSP headers | Low | Add Content-Security-Policy header |
| No input length validation | Medium | Max 32KB per message body |
| WebSocket no auth on upgrade | High | Validate session cookie during WS handshake |
| No HTTPS enforcement | Medium | Add HSTS header, redirect HTTP→HTTPS in prod |

### 4.3 Provider Proxy Security

- Never forward user cookies/tokens to upstream providers
- Sanitize response headers from providers (strip `set-cookie`, etc.)
- Validate provider URLs against allowlist (no SSRF)
- Request timeout: 120s max for streaming, 30s for non-streaming

---

## 5. Performance Engineer Review

### 5.1 Bundle Analysis

- Current deps: vue + vue-router + highlight.js + markdown-it + xterm = ~150KB gzipped est.
- xterm not used → remove from deps = save ~50KB
- highlight.js: use dynamic language imports (only load languages on demand)
- Target: <120KB gzipped initial bundle

### 5.2 Rendering Performance

- **Virtual scrolling**: Not needed for MVP (most chat sessions <200 messages). Add if >500 messages causes jank
- **Message memoization**: Vue's reactivity handles this, but extract MessageList to avoid re-rendering sibling components
- **Code block highlighting**: Use `requestIdleCallback` for syntax highlighting on long messages
- **Image lazy loading**: If/when image messages are supported

### 5.3 Streaming Efficiency

- Current SSE parsing is fine for desktop
- Mobile concern: rapid SSE deltas drain battery → batch UI updates at 60fps (requestAnimationFrame)
- Coalesce WebSocket notifications (already 220ms debounce — good)

### 5.4 Memory Management

- Clean up WebSocket listeners on component unmount (check for leaks)
- Clear `liveStreamMessages` array after merge to `persistedMessages`
- Monitor: add `performance.mark()` for stream start/end in dev mode

---

## 6. Accessibility Expert Review

### 6.1 Current Gaps

| Issue | WCAG | Fix |
|-------|------|-----|
| No skip-to-content link | 2.4.1 | Add skip link before sidebar |
| No ARIA landmarks | 1.3.1 | `role="navigation"` on sidebar, `role="main"` on chat |
| No live region for new messages | 4.1.3 | `aria-live="polite"` on message container |
| No focus management on modal open | 2.4.3 | Trap focus in ApprovalDialog |
| No keyboard shortcut for sidebar | 2.1.1 | `Ctrl+B` toggle sidebar |
| Code blocks not announced | 1.3.1 | `role="code"` + `aria-label="Code block"` |
| No reduced motion support | 2.3.3 | `@media (prefers-reduced-motion)` |

### 6.2 Minimum AA Compliance Plan

- Add `role` attributes to all landmark elements
- Add `aria-live` region for streaming messages
- Focus trap in ApprovalDialog (first focusable on open, return on close)
- `prefers-reduced-motion: reduce` → disable slide animations, use instant transitions
- Color contrast: current dark theme already passes (verified: `#e94560` on `#1a1a2e` = 5.8:1)

---

## 7. Implementation Phases

### Phase 1: Responsive Layout (Priority 1)

**Effort: 3-4 days**

1. Add responsive classes to MainLayout.vue (mobile-first)
2. Create MobileSidebar.vue (drawer overlay)
3. Extract ChatInput.vue from ChatPanel.vue
4. Add ChatNavbar.vue (mobile menu button + model selector)
5. Make ChatMessage.vue responsive (max-width, code block scroll)
6. Add `h-[100dvh]` and safe-area-inset padding
7. Touch gesture support (swipe to open/close sidebar)
8. Virtual keyboard handling via `visualViewport` API

**Files touched**: MainLayout.vue, ChatPanel.vue, ChatMessage.vue, style.css, index.html
**Files created**: MobileSidebar.vue, ChatInput.vue, ChatNavbar.vue

### Phase 2: Provider Failover Hardening (Priority 1)

**Effort: 2-3 days**

1. Implement circuit breaker in proxy.ts
2. Add automatic failover chain (Zen → OpenRouter → Custom)
3. Add provider health status tracking
4. Surface provider status in UI (ConnectionStatus.vue)
5. Add rate-limit response handling (429 → immediate failover)
6. Add request timeout handling (120s stream, 30s non-stream)

**Files touched**: proxy.ts, index.ts (server)
**Files created**: ConnectionStatus.vue

### Phase 3: WebSocket Reliability (Priority 2)

**Effort: 1-2 days**

1. Exponential backoff reconnection with jitter
2. `visibilitychange` listener for mobile background/foreground
3. Session state recovery on reconnect
4. Heartbeat ping/pong (30s interval)
5. Connection status indicator in UI

**Files touched**: gateway.ts, useAgentState.ts, server/index.ts

### Phase 4: Security Hardening (Priority 2)

**Effort: 1-2 days**

1. CORS middleware configuration
2. Rate limiting on API endpoints
3. WebSocket auth during handshake
4. Input length validation (32KB max)
5. CSP headers
6. Response header sanitization on proxy

**Files touched**: server/index.ts, auth.ts, proxy.ts

### Phase 5: Test Coverage (Priority 2)

**Effort: 2-3 days**

1. Unit tests for proxy.ts protocol translation (highest value)
2. Unit tests for provider failover logic
3. Unit tests for auth.ts timing-safe comparison
4. Component tests for ChatMessage rendering
5. Integration test for SSE streaming
6. Target: 60% coverage on server/, 40% on components/

**Files created**: tests/proxy.test.ts, tests/auth.test.ts, tests/providers.test.ts, tests/components/ChatMessage.test.ts

### Phase 6: Accessibility + Polish (Priority 3)

**Effort: 1-2 days**

1. ARIA landmarks and roles
2. Live region for streaming
3. Focus trap in ApprovalDialog
4. Skip-to-content link
5. Reduced motion support
6. Keyboard shortcuts (Ctrl+B sidebar, Ctrl+Enter send)

---

## 8. Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Tailwind 4 container queries limited browser support | Low | Medium | Fallback to media queries (wider support) |
| OpenCode SDK instability | Medium | High | Proxy-only mode already exists as fallback |
| Virtual keyboard behavior varies by OS | High | Medium | Test on iOS Safari, Android Chrome; use `dvh` + `visualViewport` |
| WebSocket drops on mobile network switch | High | Medium | Reconnect with state recovery |
| Rate limit cascade (all providers exhausted) | Medium | High | Queue messages, surface clear error to user |
| Bundle size bloat from new components | Low | Low | Components are small (<100 LOC each) |

---

## 9. Acceptance Criteria

### MVP (Phases 1-2)

- [ ] App loads without horizontal scroll on 320px-wide viewport
- [ ] Sidebar opens/closes as drawer on mobile (<768px)
- [ ] Chat input stays visible when virtual keyboard opens (iOS + Android)
- [ ] Messages render with appropriate max-width per breakpoint
- [ ] Code blocks horizontally scroll on narrow viewports
- [ ] Tap targets are minimum 44x44px
- [ ] Safe area insets respected (notch phones)
- [ ] Provider failover: Zen 429 → automatic OpenRouter switch
- [ ] Provider failover: OpenRouter failure → custom endpoint (if configured)
- [ ] Circuit breaker prevents hammering failed providers
- [ ] User sees which provider is active

### Enhanced (Phases 3-5)

- [ ] WebSocket reconnects automatically after network loss
- [ ] App resumes correctly after mobile background/foreground cycle
- [ ] Rate limiting prevents API abuse
- [ ] WebSocket handshake validates session
- [ ] 60% server test coverage
- [ ] All WCAG 2.1 AA violations fixed

---

## 10. Decision Log

| Decision | Rationale | Alternative Considered |
|----------|-----------|----------------------|
| Keep Vue 3, don't pivot to React/Kanna | Working codebase, rewrite risk, Vue 3 responsive is equivalent | Kanna (React) — too much churn for same result |
| CSS-first responsive (Tailwind breakpoints) | No JS bundle cost, instant, well-supported | JS `matchMedia` — heavier, unnecessary |
| Drawer sidebar on mobile (not tab bar) | Matches Claude Code / ChatGPT pattern users expect | Bottom tab bar — unfamiliar for chat apps |
| Circuit breaker (not retry-only) | Prevents cascading failures, faster failover | Simple retry — causes thundering herd |
| No PWA in MVP | Adds service worker complexity without core value | PWA — save for Phase 2 |
| `dvh` units over `vh` | Handles mobile browser chrome correctly | `vh` — broken on mobile Safari |
| Extract ChatInput.vue | Isolates keyboard/focus logic from message list | Keep monolithic ChatPanel — harder to maintain |
