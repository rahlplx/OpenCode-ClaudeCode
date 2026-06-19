import { describe, it, expect } from "vitest";
import { isClientEnvelope } from "../src/shared/protocol.js";
import type { ClientEnvelope, ServerEnvelope, SubscriptionTopic } from "../src/shared/protocol.js";

describe("isClientEnvelope", () => {
  it("accepts a valid subscribe envelope", () => {
    const env: ClientEnvelope = { v: 1, type: "subscribe", id: "sub-1", topic: { type: "sidebar" } };
    expect(isClientEnvelope(env)).toBe(true);
  });

  it("accepts a valid unsubscribe envelope", () => {
    const env: ClientEnvelope = { v: 1, type: "unsubscribe", id: "sub-1" };
    expect(isClientEnvelope(env)).toBe(true);
  });

  it("accepts a valid command envelope", () => {
    const env: ClientEnvelope = { v: 1, type: "command", id: "cmd-1", command: { type: "system.ping" } };
    expect(isClientEnvelope(env)).toBe(true);
  });

  it("rejects null", () => {
    expect(isClientEnvelope(null)).toBe(false);
  });

  it("rejects non-object", () => {
    expect(isClientEnvelope("string")).toBe(false);
    expect(isClientEnvelope(42)).toBe(false);
  });

  it("rejects wrong version", () => {
    expect(isClientEnvelope({ v: 2, type: "subscribe", id: "x", topic: { type: "sidebar" } })).toBe(false);
  });

  it("rejects missing type", () => {
    expect(isClientEnvelope({ v: 1, id: "x" })).toBe(false);
  });

  it("rejects missing v field", () => {
    expect(isClientEnvelope({ type: "subscribe", id: "x", topic: { type: "sidebar" } })).toBe(false);
  });

  it("rejects random JSON object", () => {
    expect(isClientEnvelope({ foo: "bar" })).toBe(false);
  });
});

describe("ClientEnvelope subscription topics", () => {
  const topics: SubscriptionTopic[] = [
    { type: "sidebar" },
    { type: "local-projects" },
    { type: "update" },
    { type: "keybindings" },
    { type: "app-settings" },
    { type: "chat", chatId: "chat-abc" },
    { type: "project-git", projectId: "proj-1" },
    { type: "terminal", terminalId: "term-1" },
  ];

  for (const topic of topics) {
    it(`subscribe envelope with topic '${topic.type}' is valid`, () => {
      const env = { v: 1 as const, type: "subscribe" as const, id: "id-1", topic };
      expect(isClientEnvelope(env)).toBe(true);
    });
  }
});

describe("ServerEnvelope shape", () => {
  it("snapshot envelope has v, type, id, snapshot", () => {
    const env: ServerEnvelope = {
      v: 1,
      type: "snapshot",
      id: "sub-1",
      snapshot: { type: "sidebar", data: { projectGroups: [] } },
    };
    expect(env.v).toBe(1);
    expect(env.type).toBe("snapshot");
    expect(env.snapshot.type).toBe("sidebar");
  });

  it("ack envelope has v, type, id", () => {
    const env: ServerEnvelope = { v: 1, type: "ack", id: "cmd-1" };
    expect(env.v).toBe(1);
    expect(env.type).toBe("ack");
  });

  it("error envelope has v, type, message", () => {
    const env: ServerEnvelope = { v: 1, type: "error", message: "not found" };
    expect(env.v).toBe(1);
    expect(env.type).toBe("error");
    expect(env.message).toBe("not found");
  });
});
