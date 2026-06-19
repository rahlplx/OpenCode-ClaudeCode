# Plan: Multi-Tenant Architecture

Systematic audit and fix plan for multi-tenant safety. Every data path must be scoped to a user — no cross-tenant data leaks, no shared mutable state.

---

## Current Multi-Tenant Violations

### CRITICAL — Data Leaks Between Users

**1. WebSocket broadcasts to ALL connected clients** — `src/server/index.ts:33-40`

```typescript
function broadcast(notification: Notification): void {
  const data = JSON.stringify(notification);
  for (const client of clients) {          // ← ALL clients
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);                   // ← User A sees User B's messages
    }
  }
}
```

**Impact**: When User A streams a message, User B receives all deltas and completions. Every connected browser sees every other user's activity — messages, tool requests, session updates.

**Fix**: Map each WebSocket to its authenticated user. Only broadcast to the user who owns the session.

```typescript
const clientsByUser = new Map<string, Set<WebSocket>>();

function broadcastToUser(userId: string, notification: Notification): void {
  const userClients = clientsByUser.get(userId);
  if (!userClients) return;
  const data = JSON.stringify(notification);
  for (const client of userClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}
```

---

**2. WebSocket has no auth — anyone can connect** — `src/server/index.ts:42-49`

```typescript
wss.on("connection", (ws) => {
  clients.add(ws);    // ← No session/user validation
});
```

**Impact**: No password needed to receive all broadcasts. Open `/api/ws` in any browser tab = full surveillance of all users' activity.

**Fix**: Validate session cookie during WebSocket upgrade handshake.

```typescript
wss.on("connection", (ws, req) => {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[COOKIE_NAME];
  const userId = getUserIdFromToken(token);
  
  if (!userId) {
    ws.close(1008, "Unauthorized");
    return;
  }
  
  // Register this client under its user
  if (!clientsByUser.has(userId)) clientsByUser.set(userId, new Set());
  clientsByUser.get(userId)!.add(ws);
  
  ws.on("close", () => {
    clientsByUser.get(userId)?.delete(ws);
  });
});
```

---

**3. RPC streaming broadcasts deltas to all users** — `src/server/index.ts:88-98`

```typescript
const result = await bridge.rpcStream(
  method, params,
  (delta: unknown) => {
    res.write(...);          // ← Correct: only to requesting client
    broadcast({              // ← BUG: to ALL connected WebSocket clients
      type: "message.delta",
      data: delta,
      sessionId: ...,
    });
  },
);
```

**Impact**: The HTTP response correctly goes to the requester only, but the `broadcast()` call sends every delta to every WebSocket client. User B's browser receives User A's streaming tokens in real-time.

**Fix**: Replace `broadcast()` with `broadcastToUser(userId, notification)`.

---

**4. Tool request approvals have no ownership check** — `src/server/index.ts:184-197`

```typescript
app.post("/api/server-requests/respond", async (req, res) => {
  const { requestId, approved } = req.body;
  await bridge.respondToRequest(requestId, approved);  // ← No user validation
});
```

**Impact**: User A can approve/deny tool requests from User B's session. Fabricating a `requestId` for another user's pending tool call lets you authorize or block their agent's actions.

**Fix**: Track which user's session generated each request. Validate ownership before responding.

```typescript
app.post("/api/server-requests/respond", async (req, res) => {
  const userId = getUserFromRequest(req);
  const { requestId, approved } = req.body;
  
  if (!bridge.isRequestOwnedBy(requestId, userId)) {
    res.status(403).json({ error: "Not your request" });
    return;
  }
  
  await bridge.respondToRequest(requestId, approved);
  res.json({ success: true });
});
```

---

### HIGH — Session Isolation Gaps

**5. Session list returns ALL sessions, not per-user** — `src/server/index.ts:75-106`

```typescript
app.post("/api/rpc", async (req, res) => {
  const { method, params } = req.body;
  const result = await bridge.rpc(method, params);  // ← No user scoping
});
```

When `method === "session.list"`, the bridge forwards to OpenCode which returns all sessions. In a multi-user deployment, User A sees User B's sessions.

**Fix**: The bridge layer needs user-scoped session management. Options:
- **Option A**: Separate OpenCode instances per user (heavy, but true isolation)
- **Option B**: Add userId to session metadata and filter on response (lighter)
- **Option C**: Prefix sessions with userId and use namespaced storage

**Recommendation**: Option B for MVP — add `userId` field to sessions, filter in the API layer.

---

**6. Single OpenCode bridge instance shared across all users** — `src/server/index.ts:30`

```typescript
const bridge = new OpenCodeBridge();  // ← One bridge for ALL users
```

**Impact**: All users share one OpenCode process. One user's heavy request blocks others. One user's abort could interfere with another's streaming session (if session IDs collide or if OpenCode doesn't isolate).

**Fix for MVP**: Accept shared bridge but add user-scoped session tracking.

**Fix for production**: Bridge pool — one bridge per active user, with lifecycle management.

```typescript
class BridgePool {
  private bridges = new Map<string, OpenCodeBridge>();
  
  async getBridge(userId: string): Promise<OpenCodeBridge> {
    if (!this.bridges.has(userId)) {
      const bridge = new OpenCodeBridge();
      await bridge.start();
      this.bridges.set(userId, bridge);
    }
    return this.bridges.get(userId)!;
  }
  
  async releaseBridge(userId: string): Promise<void> {
    const bridge = this.bridges.get(userId);
    if (bridge) {
      await bridge.close();
      this.bridges.delete(userId);
    }
  }
}
```

---

### MEDIUM — Auth System Not User-Aware

**7. Auth has sessions but no users** — `src/server/auth.ts:12-22`

```typescript
const activeSessions = new Map<string, SessionEntry>();

interface SessionEntry {
  token: string;
  createdAt: number;
  // ← No userId field
}
```

**Impact**: Auth knows "someone is logged in" but not WHO. Cannot scope data to users. Every authenticated request looks the same — there's no user identity.

**Fix**: Add user identity to sessions.

```typescript
interface SessionEntry {
  token: string;
  userId: string;
  createdAt: number;
}

// Single-password mode: userId = "default" (backwards compatible)
// Multi-user mode: userId from registration/invite

export function createSession(userId: string): string {
  const token = randomBytes(32).toString("hex");
  activeSessions.set(token, { token, userId, createdAt: Date.now() });
  return token;
}

export function getUserIdFromToken(token: string): string | null {
  const session = activeSessions.get(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL) {
    activeSessions.delete(token);
    return null;
  }
  return session.userId;
}
```

---

**8. Single shared password** — `src/server/index.ts:24`

```typescript
const password = options.password || generatePassword();  // ← One password for all users
```

**Impact**: Everyone who knows the password sees everything. No per-user identity.

**Fix for MVP**: Map single password to `userId: "default"`. All single-password users share the same tenant (acceptable for personal deployment).

**Fix for production**: User registration with individual credentials.

```typescript
interface UserRecord {
  userId: string;
  passwordHash: Buffer;
}

const users = new Map<string, UserRecord>();

// Register user (invite-only or self-service)
function registerUser(userId: string, password: string): void {
  const hash = createHash("sha256").update(password).digest();
  users.set(userId, { userId, passwordHash: hash });
}
```

---

### MEDIUM — Frontend Cross-Tenant Risks

**9. Frontend receives ALL WebSocket notifications indiscriminately** — `src/composables/useAgentState.ts:131-153`

```typescript
function handleNotification(notification: Notification): void {
  switch (notification.type) {
    case "message.delta":
      applyMessageDelta(notification);  // ← Applies ANY delta, even from other users
      break;
    case "tool.request":
      applyToolRequest(notification);   // ← Shows ANY tool request in UI
      break;
  }
}
```

**Impact**: If WebSocket broadcast is fixed server-side, this is fine. But defense-in-depth: frontend should validate that notifications belong to the current user's sessions.

**Fix**: Check `notification.sessionId` against known session IDs.

```typescript
function handleNotification(notification: Notification): void {
  const knownSessionIds = new Set(sessions.value.map(s => s.id));
  
  if (notification.sessionId && !knownSessionIds.has(notification.sessionId)) {
    return; // Not our session, ignore
  }
  // ... handle notification
}
```

---

**10. localStorage keys not user-scoped** — `src/composables/useAgentState.ts:14-25`

```typescript
function loadFromStorage<T>(key: string, fallback: T): T {
  const stored = localStorage.getItem(`occ.${key}`);  // ← Same keys for all users
}
```

**Impact**: If two users share a browser (unlikely but possible), they see each other's selected session, model preferences, sidebar state.

**Fix**: Scope localStorage keys to userId.

```typescript
function loadFromStorage<T>(key: string, fallback: T, userId?: string): T {
  const prefix = userId ? `occ.${userId}.` : "occ.";
  const stored = localStorage.getItem(`${prefix}${key}`);
  return stored ? JSON.parse(stored) : fallback;
}
```

---

## Multi-Tenant Architecture: Target State

```
                    ┌─────────────────────────┐
                    │   Load Balancer / CDN    │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │     Express Server       │
                    │                          │
                    │  ┌──────────────────┐   │
                    │  │   Auth Layer      │   │
                    │  │  (user identity)  │   │
                    │  └────────┬─────────┘   │
                    │           │              │
                    │  ┌────────▼─────────┐   │
                    │  │  Tenant Router    │   │
                    │  │  (scopes all ops  │   │
                    │  │   to userId)      │   │
                    │  └────────┬─────────┘   │
                    │           │              │
                    │  ┌────────▼─────────┐   │
                    │  │ WebSocket Hub     │   │
                    │  │ (per-user routing)│   │
                    │  └────────┬─────────┘   │
                    │           │              │
                    │  ┌────────▼─────────┐   │
                    │  │  Bridge Layer     │   │
                    │  │  (session scoping)│   │
                    │  └──────────────────┘   │
                    └─────────────────────────┘
```

### Isolation Guarantees

| Layer | Isolation Method | Current | Target |
|-------|-----------------|---------|--------|
| **Auth** | User identity per session token | Token only, no user ID | Token + userId |
| **HTTP API** | Filter responses by userId | No filtering | All queries scoped |
| **WebSocket** | Per-user client sets | Broadcast to ALL | Broadcast to owner only |
| **Bridge/RPC** | Session ownership tracking | Shared, unscoped | Session → userId map |
| **Tool requests** | Ownership validation | None | requestId → userId check |
| **Provider proxy** | Per-user rate tracking | Global rate state | Per-user rate buckets |
| **Frontend** | Session ID validation | Accepts all notifications | Filters by known sessions |
| **Storage** | User-scoped keys | Global `occ.*` keys | `occ.{userId}.*` keys |

---

## Implementation Plan

### Phase 0: User Identity (Foundation) — 0.5 days

1. Add `userId` to `SessionEntry` in `auth.ts`
2. Export `getUserIdFromToken()` and `parseCookies()` from auth.ts
3. Single-password mode maps to `userId: "default"`
4. Add helper middleware `getUserFromRequest(req)` that extracts userId from cookie

**Files**: `src/server/auth.ts`

### Phase 1: WebSocket Isolation (Highest Impact) — 0.5 days

5. Replace `clients: Set<WebSocket>` with `clientsByUser: Map<string, Set<WebSocket>>`
6. Validate session cookie during WS upgrade handshake (`wss.on("connection")`)
7. Replace `broadcast()` with `broadcastToUser(userId, notification)`
8. In `/api/rpc` streaming handler, resolve userId from request and scope broadcast

**Files**: `src/server/index.ts`

### Phase 2: API Scoping — 1 day

9. Track session ownership: `sessionOwnership: Map<sessionId, userId>`
10. When `session.create` succeeds, record `sessionId → userId`
11. When `session.list` returns, filter to current user's sessions
12. Validate ownership on `session.chat`, `session.abort`
13. Add ownership check to `/api/server-requests/respond`
14. Scope `session.list` response filtering in the RPC handler

**Files**: `src/server/index.ts`, `src/server/bridge.ts`

### Phase 3: Frontend Defense-in-Depth — 0.5 days

15. Filter incoming WebSocket notifications against known session IDs
16. Scope localStorage keys to userId (passed from server after login)
17. Clear state on logout/user switch

**Files**: `src/composables/useAgentState.ts` (or React equivalent after pivot)

### Phase 4: Multi-User Auth (Production) — 1 day

18. User registration endpoint (`/api/auth/register`)
19. Per-user password storage with bcrypt/argon2
20. Invite-only mode (admin generates invite codes)
21. Per-user rate limiting buckets in proxy

**Files**: `src/server/auth.ts`, `src/server/index.ts`, `src/server/proxy.ts`

---

## Testing Checklist

### Isolation Tests

- [ ] User A creates session → User B's `session.list` does NOT include it
- [ ] User A streams message → User B's WebSocket does NOT receive deltas
- [ ] User A gets tool request → User B cannot approve/deny it
- [ ] User A's rate limit does NOT affect User B
- [ ] Unauthenticated WebSocket connection is rejected with 1008
- [ ] User A's localStorage preferences are isolated from User B
- [ ] After logout, no stale data from previous user visible

### Regression Tests

- [ ] Single-user mode (`--no-password`) still works without userId overhead
- [ ] WebSocket reconnection still works after auth validation added
- [ ] Session creation optimistic UI still works with ownership tracking
- [ ] Provider failover still functions per-user

### Stress Tests

- [ ] 10 concurrent users streaming simultaneously — no cross-talk
- [ ] User disconnect mid-stream — other users unaffected
- [ ] Session token expiry during WebSocket — graceful disconnect
- [ ] Rapid session creation by multiple users — no ID collision

---

## Backwards Compatibility

**Single-user deployment** (most common for personal use):
- `--no-password` flag → `userId: "default"`, all data in one tenant
- Zero behavior change from current implementation
- Multi-tenant code paths exist but are no-ops for single user

**Multi-user deployment** (team/hosted):
- Requires user registration or invite codes
- Each user gets isolated session namespace
- Shared OpenCode bridge with session-scoped isolation
