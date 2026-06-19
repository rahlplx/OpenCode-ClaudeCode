import { describe, it, expect, beforeEach } from "vitest";
import { useSessionsStore } from "../src/client/stores/sessions";
import { useChatStore } from "../src/client/stores/chat";
import type { Message, Notification } from "../src/types";

describe("sessions store", () => {
  beforeEach(() => {
    useSessionsStore.setState({
      sessions: [],
      selectedId: null,
      loading: false,
    });
  });

  it("starts with empty state", () => {
    const state = useSessionsStore.getState();
    expect(state.sessions).toEqual([]);
    expect(state.selectedId).toBeNull();
  });

  it("selects a session", () => {
    useSessionsStore.getState().select("session-1");
    expect(useSessionsStore.getState().selectedId).toBe("session-1");
  });
});

describe("chat store", () => {
  beforeEach(() => {
    useChatStore.setState({
      messagesBySession: new Map(),
      liveMessages: new Map(),
      pendingApprovals: [],
      generatingSessions: new Set(),
      error: null,
      inputText: "",
      activeProvider: "zen",
    });
    useSessionsStore.setState({ selectedId: "s1" });
  });

  it("starts with empty messages", () => {
    const messages = useChatStore.getState().currentMessages();
    expect(messages).toEqual([]);
  });

  it("handles message delta notification", () => {
    const notification: Notification = {
      type: "message.delta",
      data: { text: "Hello ", id: "msg-1" },
      sessionId: "s1",
    };
    useChatStore.getState().handleNotification(notification);

    const live = useChatStore.getState().liveMessages.get("s1");
    expect(live).toHaveLength(1);
    expect(live![0].content).toBe("Hello ");
    expect(live![0].isStreaming).toBe(true);
  });

  it("appends to existing streaming message", () => {
    useChatStore.getState().handleNotification({
      type: "message.delta",
      data: { text: "Hello " },
      sessionId: "s1",
    });
    useChatStore.getState().handleNotification({
      type: "message.delta",
      data: { text: "world" },
      sessionId: "s1",
    });

    const live = useChatStore.getState().liveMessages.get("s1");
    expect(live).toHaveLength(1);
    expect(live![0].content).toBe("Hello world");
  });

  it("handles message complete notification", () => {
    const message: Message = {
      id: "msg-complete",
      sessionId: "s1",
      role: "assistant",
      content: "Done!",
      timestamp: Date.now(),
    };

    useChatStore.getState().handleNotification({
      type: "message.complete",
      data: message,
      sessionId: "s1",
    });

    const persisted = useChatStore.getState().messagesBySession.get("s1");
    expect(persisted).toHaveLength(1);
    expect(persisted![0].content).toBe("Done!");
    expect(persisted![0].isStreaming).toBe(false);

    const live = useChatStore.getState().liveMessages.get("s1");
    expect(live).toEqual([]);
  });

  it("handles tool request notification", () => {
    useChatStore.getState().handleNotification({
      type: "tool.request",
      data: {
        id: "req-1",
        sessionId: "s1",
        type: "command",
        description: "Run npm test",
        args: { command: "npm test" },
        status: "pending",
      },
    });

    expect(useChatStore.getState().pendingApprovals).toHaveLength(1);
    expect(useChatStore.getState().pendingApprovals[0].id).toBe("req-1");
  });

  it("handles error notification", () => {
    useChatStore.getState().handleNotification({
      type: "error",
      data: { message: "Something went wrong" },
    });

    expect(useChatStore.getState().error).toBe("Something went wrong");
  });

  it("handles rate limit notification", () => {
    useChatStore.getState().handleNotification({
      type: "rate_limit",
      data: { provider: "zen", retryAfter: 30 },
    });

    expect(useChatStore.getState().error).toContain("Rate limited by zen");
    expect(useChatStore.getState().error).toContain("30s");
  });

  it("clears error", () => {
    useChatStore.setState({ error: "test error" });
    useChatStore.getState().clearError();
    expect(useChatStore.getState().error).toBeNull();
  });

  it("sets provider", () => {
    useChatStore.getState().setProvider("openrouter");
    expect(useChatStore.getState().activeProvider).toBe("openrouter");
  });

  it("sets input text", () => {
    useChatStore.getState().setInputText("hello");
    expect(useChatStore.getState().inputText).toBe("hello");
  });

  it("merges persisted and live messages in currentMessages", () => {
    const persisted: Message = {
      id: "p1",
      sessionId: "s1",
      role: "user",
      content: "Question",
      timestamp: Date.now(),
    };

    useChatStore.setState({
      messagesBySession: new Map([["s1", [persisted]]]),
      liveMessages: new Map([
        ["s1", [{ id: "l1", sessionId: "s1", role: "assistant" as const, content: "Answer...", timestamp: Date.now(), isStreaming: true }]],
      ]),
    });

    const messages = useChatStore.getState().currentMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
  });

  it("ignores delta with no sessionId", () => {
    useChatStore.getState().handleNotification({
      type: "message.delta",
      data: { text: "orphan" },
    });
    expect(useChatStore.getState().liveMessages.size).toBe(0);
  });

  it("ignores delta with empty text", () => {
    useChatStore.getState().handleNotification({
      type: "message.delta",
      data: { text: "" },
      sessionId: "s1",
    });
    expect(useChatStore.getState().liveMessages.get("s1")).toBeUndefined();
  });
});
