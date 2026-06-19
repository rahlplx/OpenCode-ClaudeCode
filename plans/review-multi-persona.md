# Multi-Persona Review: Security Audit + Architecture Stress Test

## Review Summary

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| Security | 2 | 4 | 6 | 3 |
| Architecture | 3 | 1 | 8 | 3 |
| **Total** | **5** | **5** | **14** | **6** |

**Overall verdict**: Plan is solid (70% score), but current implementation has significant gaps — zero responsive CSS, no provider failover chain, no WebSocket auth, dead dependencies.

---

## SECURITY AUDIT

### Critical

**1. WebSocket Authentication Bypass** — `src/server/index.ts:42-48`
WebSocket connections accepted without session validation. Any browser can connect to `/api/ws` and receive all broadcasted notifications.

**2. Server Request Response — No Ownership Validation** — `src/server/index.ts:184-197`
`/api/server-requests/respond` doesn't validate that `requestId` belongs to the authenticated user's session.

### High

**3. Proxy Response Injection** — `src/server/proxy.ts:275-281`
Upstream error responses echoed directly to clients unsanitized — potential reflected XSS.

**4. Health Endpoint Info Leakage** — `src/server/index.ts:67-73`
Unauthenticated `/api/health` reveals OpenCode connection status (reconnaissance vector).

**5. In-Memory Session Storage** — `src/server/auth.ts:12-21`
Server restart invalidates all sessions. No multi-instance support.

**6. Custom Provider Empty URL → SSRF** — `src/server/index.ts:166-175`
Custom provider has empty URLs. Fetching empty string resolves to localhost (SSRF).

### Medium

- **No CORS configuration** — any origin can POST to `/api/rpc`
- **No security headers** — missing CSP, X-Frame-Options, HSTS
- **No body size validation in proxy** — `readRequestBody()` has no size limit
- **Error messages may leak API info** — proxy.ts catch blocks echo raw errors
- **localStorage stores session IDs** — XSS could exfiltrate activity data
- **No rate limiting on login** — unlimited brute-force attempts

### Low

- Hardcoded Zen public token (intentional for free tier)
- No RPC method allowlist (methods pass through to bridge unchecked)
- `exec()` in ChatMessage.vue (safe — static regex, not user input)

---

## ARCHITECTURE STRESS TEST

### Skeptical Architect Findings

**Circuit breaker not implemented (HIGH)**: Plan calls for 3-consecutive-failure tracking with 60s skip. Actual proxy.ts just returns 429 to client — no automatic failover chain. Zen → OpenRouter → Custom is documented but not coded.

**SSE mid-stream failure is fatal (HIGH)**: If Zen times out during SSE streaming, response cuts off. No buffering, no mid-stream provider switch. Plan acknowledges this but has no solution.

**WebSocket reconnection uses fixed 3s (MEDIUM)**: `bridge.ts:188` hardcodes `setTimeout(..., 3000)`. Plan requires exponential backoff (1s, 2s, 4s, 8s, max 30s) with jitter.

**No session state recovery on reconnect (MEDIUM)**: Reconnect just calls `connectWebSocket()` again with no state validation.

### Mobile QA Tester Findings

**320px completely broken (HIGH)**: Sidebar `w-64` (256px) + chat = >320px. Horizontal scrollbar on all phones. No drawer overlay, no responsive hide.

**Code blocks overflow on mobile (MEDIUM)**: `overflow-x-auto` exists but no `-webkit-overflow-scrolling: touch`, no mobile max-width constraint.

**Virtual keyboard breaks layout (MEDIUM)**: Textarea `max-height: 200px` hardcoded, no `dvh` units, no `visualViewport` API. On phone with keyboard, input may exceed visible area.

**Tap targets too small (MEDIUM)**: Send button `p-1.5` ≈ 24-32px. WCAG 2.5.8 requires 44x44px minimum.

**No safe-area-insets (MEDIUM)**: iPhone notch/home indicator overlaps buttons.

### DevOps Engineer Findings

**xterm is dead weight (HIGH)**: `xterm` + `xterm-addon-fit` in package.json, zero imports in src/. Adds ~50KB gzipped.

**@opencode-ai/sdk pinned to "latest" (MEDIUM)**: Breaking changes or npm unavailability = install failure for all users.

**Source maps in production (LOW)**: `sourcemap: true` in vite.config.ts leaks source code if deployed to CDN.

---

## FRAMEWORK DECISION: Vue 3 vs React

**Open question**: Kanna (locked web UI reference) uses React + Zustand. Current codebase is Vue 3. Rewrite cost is ~2-3 days (only 2000 LOC of Vue). Staying on Vue means translating every Kanna pattern (hooks→composables, Zustand→Pinia, ResizablePanelGroup→custom).

| Factor | Vue 3 | React (Kanna-aligned) |
|--------|-------|----------------------|
| Kanna code reuse | Manual translation | Direct lift |
| Responsive patterns | Re-implement from scratch | Copy react-resizable-panels |
| Rewrite cost | 0 | 2-3 days |
| Ongoing maintenance | Higher (constant translation) | Lower (same ecosystem) |

**Recommendation**: Pivot to React + Zustand. Backend (Express, proxy, bridge, auth, providers) stays identical.

---

## PRIORITY ACTION LIST

### Immediate (Before any feature work)

1. Remove `xterm` + `xterm-addon-fit` from package.json
2. Pin `@opencode-ai/sdk` to specific version
3. Add WebSocket auth during upgrade handshake
4. Add CORS middleware with explicit allowlist
5. Validate custom provider URLs before fetch (prevent SSRF)
6. Sanitize upstream error responses in proxy.ts

### Phase 1: Responsive Layout (3-4 days)

7. Add responsive Tailwind breakpoints to all components
8. Create mobile sidebar drawer (full-screen overlay <768px)
9. Extract ChatInput with keyboard-aware sizing (`dvh`, `visualViewport`)
10. Add safe-area-inset padding
11. Increase all tap targets to 44x44px minimum
12. Add `-webkit-overflow-scrolling: touch` to code blocks

### Phase 2: Provider Failover (2-3 days)

13. Implement circuit breaker with per-provider failure tracking
14. Build automatic failover chain: Zen → OpenRouter → Custom
15. Handle 429 responses with immediate failover
16. Add ConnectionStatus indicator to UI
17. Add request timeout handling (120s stream, 30s non-stream)

### Phase 3: Reliability (1-2 days)

18. Exponential backoff + jitter for WebSocket reconnection
19. Session state recovery on reconnect
20. Rate limiting on `/api/rpc` and `/api/auth/login`
21. Add security headers (CSP, X-Frame-Options, HSTS)

### Phase 4: Tests (2-3 days)

22. Unit tests for proxy protocol translation
23. Unit tests for circuit breaker / failover logic
24. Unit tests for auth timing-safe comparison
25. Component tests for responsive breakpoints
26. Target: 60% server coverage, 40% component coverage
