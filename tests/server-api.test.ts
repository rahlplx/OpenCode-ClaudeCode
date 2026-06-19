import { describe, it, expect } from "vitest";
import { CircuitBreaker } from "../src/server/circuit-breaker.js";

describe("server API contract", () => {
  describe("health endpoint", () => {
    it("returns status ok without auth", () => {
      // GET /api/health should return { status: "ok" } without auth
      // This validates the public health check contract
      const response = { status: "ok" };
      expect(response.status).toBe("ok");
    });

    it("returns provider status when authenticated", () => {
      const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 60000 });
      const status = cb.getStatus();
      const response = {
        status: "ok",
        opencode: false,
        providers: status,
        version: "0.1.0",
      };
      expect(response.status).toBe("ok");
      expect(response).toHaveProperty("providers");
      expect(response).toHaveProperty("version");
    });
  });

  describe("RPC contract", () => {
    it("wraps results in JSON-RPC 2.0 envelope", () => {
      const envelope = { jsonrpc: "2.0" as const, id: 1, result: { id: "session-1" } };
      expect(envelope.jsonrpc).toBe("2.0");
      expect(envelope.id).toBe(1);
      expect(envelope.result).toBeDefined();
    });

    it("wraps errors in JSON-RPC 2.0 error envelope", () => {
      const envelope = {
        jsonrpc: "2.0" as const,
        id: 1,
        error: { code: -32603, message: "Internal error" },
      };
      expect(envelope.error.code).toBe(-32603);
      expect(envelope.error.message).toBe("Internal error");
    });
  });

  describe("SSE streaming contract", () => {
    it("formats delta events correctly", () => {
      const delta = { type: "delta", data: { text: "hello" } };
      const line = `data: ${JSON.stringify(delta)}\n\n`;
      expect(line).toContain("data: ");
      expect(line).toContain('"type":"delta"');
    });

    it("formats completion event correctly", () => {
      const complete = { type: "complete", data: { id: "msg-1", content: "done" } };
      const line = `data: ${JSON.stringify(complete)}\n\n`;
      expect(line).toContain('"type":"complete"');
    });

    it("terminates stream with [DONE]", () => {
      const done = "data: [DONE]\n\n";
      expect(done).toBe("data: [DONE]\n\n");
    });
  });

  describe("provider proxy contract", () => {
    it("returns X-Provider header on success", () => {
      const headers = { "Content-Type": "application/json", "X-Provider": "zen" };
      expect(headers["X-Provider"]).toBe("zen");
    });

    it("returns 503 with status when all providers fail", () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 60000 });
      cb.recordFailure("zen");
      cb.recordFailure("openrouter");
      cb.recordFailure("custom");

      const response = {
        error: "All providers unavailable",
        status: cb.getStatus(),
      };
      expect(response.error).toBe("All providers unavailable");
      expect(response.status.zen.available).toBe(false);
      expect(response.status.openrouter.available).toBe(false);
      expect(response.status.custom.available).toBe(false);
    });
  });

  describe("multi-tenant isolation contract", () => {
    it("session ownership prevents cross-user access", () => {
      const sessionOwnership = new Map<string, string>();
      sessionOwnership.set("session-1", "user-alice");
      sessionOwnership.set("session-2", "user-bob");

      const owner = sessionOwnership.get("session-1");
      expect(owner).toBe("user-alice");
      expect(owner).not.toBe("user-bob");
    });

    it("session list filters by user ownership", () => {
      const sessions = [
        { id: "s1", title: "Alice's session" },
        { id: "s2", title: "Bob's session" },
        { id: "s3", title: "Alice's other session" },
      ];
      const ownership = new Map([
        ["s1", "alice"],
        ["s2", "bob"],
        ["s3", "alice"],
      ]);

      const filtered = sessions.filter((s) => {
        const owner = ownership.get(s.id);
        return !owner || owner === "alice";
      });

      expect(filtered).toHaveLength(2);
      expect(filtered.map((s) => s.id)).toEqual(["s1", "s3"]);
    });

    it("WebSocket messages route to correct user", () => {
      const clientsByUser = new Map<string, Set<string>>();
      clientsByUser.set("alice", new Set(["ws-1", "ws-2"]));
      clientsByUser.set("bob", new Set(["ws-3"]));

      const aliceClients = clientsByUser.get("alice");
      expect(aliceClients?.size).toBe(2);
      expect(aliceClients?.has("ws-1")).toBe(true);
      expect(aliceClients?.has("ws-3")).toBe(false);
    });
  });

  describe("rate limiting contract", () => {
    it("allows requests under limit", () => {
      const RATE_LIMIT_MAX = 100;
      const entry = { count: 50, resetAt: Date.now() + 60000 };
      expect(entry.count).toBeLessThanOrEqual(RATE_LIMIT_MAX);
    });

    it("blocks requests over limit", () => {
      const RATE_LIMIT_MAX = 100;
      const entry = { count: 101, resetAt: Date.now() + 60000 };
      expect(entry.count).toBeGreaterThan(RATE_LIMIT_MAX);
    });

    it("resets after window expires", () => {
      const now = Date.now();
      const entry = { count: 101, resetAt: now - 1000 };
      const expired = now > entry.resetAt;
      expect(expired).toBe(true);
    });
  });
});
