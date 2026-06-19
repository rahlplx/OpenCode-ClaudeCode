import { describe, it, expect, beforeEach } from "vitest";
import { ChatSessionManager } from "../src/server/chat-session-manager.js";

describe("ChatSessionManager", () => {
  let manager: ChatSessionManager;

  beforeEach(() => {
    manager = new ChatSessionManager();
  });

  describe("chat.create", () => {
    it("creates a chat session for a project", () => {
      const chat = manager.createChat("project-1", "user-1");
      expect(chat.runtime.chatId).toBeTruthy();
      expect(chat.runtime.projectId).toBe("project-1");
      expect(chat.runtime.status).toBe("idle");
      expect(chat.messages).toEqual([]);
    });

    it("creates unique chat IDs", () => {
      const chat1 = manager.createChat("project-1", "user-1");
      const chat2 = manager.createChat("project-1", "user-1");
      expect(chat1.runtime.chatId).not.toBe(chat2.runtime.chatId);
    });

    it("sets provider to null initially", () => {
      const chat = manager.createChat("project-1", "user-1");
      expect(chat.runtime.provider).toBeNull();
    });

    it("includes provider catalog in snapshot", () => {
      const chat = manager.createChat("project-1", "user-1");
      expect(chat.availableProviders.length).toBeGreaterThan(0);
      const claude = chat.availableProviders.find((p) => p.id === "claude");
      expect(claude).toBeDefined();
      expect(claude!.models.length).toBeGreaterThan(0);
    });
  });

  describe("chat ownership", () => {
    it("tracks chat ownership by user", () => {
      const chat = manager.createChat("project-1", "alice");
      expect(manager.getChatOwner(chat.runtime.chatId)).toBe("alice");
    });

    it("prevents cross-user chat access", () => {
      const chat = manager.createChat("project-1", "alice");
      expect(manager.canAccess(chat.runtime.chatId, "alice")).toBe(true);
      expect(manager.canAccess(chat.runtime.chatId, "bob")).toBe(false);
    });
  });

  describe("chat.send", () => {
    it("adds user message to transcript", () => {
      const chat = manager.createChat("project-1", "user-1");
      const chatId = chat.runtime.chatId;

      manager.addUserMessage(chatId, "Hello AI", "claude", "claude-sonnet-4-6");

      const snapshot = manager.getChat(chatId);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.messages.length).toBe(1);
      expect(snapshot!.messages[0].kind).toBe("user_prompt");
    });

    it("sets chat status to running on send", () => {
      const chat = manager.createChat("project-1", "user-1");
      const chatId = chat.runtime.chatId;

      manager.addUserMessage(chatId, "Hello", "claude", "claude-sonnet-4-6");

      const snapshot = manager.getChat(chatId);
      expect(snapshot!.runtime.status).toBe("running");
      expect(snapshot!.runtime.provider).toBe("claude");
    });

    it("stores provider selection", () => {
      const chat = manager.createChat("project-1", "user-1");
      const chatId = chat.runtime.chatId;

      manager.addUserMessage(chatId, "Code review", "codex", "gpt-5.5");

      const snapshot = manager.getChat(chatId);
      expect(snapshot!.runtime.provider).toBe("codex");
    });
  });

  describe("chat.cancel", () => {
    it("sets status to idle on cancel", () => {
      const chat = manager.createChat("project-1", "user-1");
      const chatId = chat.runtime.chatId;

      manager.addUserMessage(chatId, "Hello", "claude", "claude-sonnet-4-6");
      manager.cancelChat(chatId);

      const snapshot = manager.getChat(chatId);
      expect(snapshot!.runtime.status).toBe("idle");
    });
  });

  describe("assistant response handling", () => {
    it("adds assistant text to transcript", () => {
      const chat = manager.createChat("project-1", "user-1");
      const chatId = chat.runtime.chatId;

      manager.addUserMessage(chatId, "Hello", "claude", "claude-sonnet-4-6");
      manager.addAssistantText(chatId, "Hello! How can I help?");

      const snapshot = manager.getChat(chatId);
      expect(snapshot!.messages.length).toBe(2);
      expect(snapshot!.messages[1].kind).toBe("assistant_text");
    });

    it("adds result entry and sets status to idle", () => {
      const chat = manager.createChat("project-1", "user-1");
      const chatId = chat.runtime.chatId;

      manager.addUserMessage(chatId, "Hello", "claude", "claude-sonnet-4-6");
      manager.addAssistantText(chatId, "Done!");
      manager.completeChat(chatId, 1500);

      const snapshot = manager.getChat(chatId);
      expect(snapshot!.runtime.status).toBe("idle");
      const result = snapshot!.messages.find((m) => m.kind === "result");
      expect(result).toBeDefined();
    });
  });

  describe("chat.rename", () => {
    it("renames a chat", () => {
      const chat = manager.createChat("project-1", "user-1");
      const chatId = chat.runtime.chatId;
      manager.renameChat(chatId, "My Chat Title");

      const snapshot = manager.getChat(chatId);
      expect(snapshot!.runtime.title).toBe("My Chat Title");
    });
  });

  describe("chat.delete", () => {
    it("removes a chat from the manager", () => {
      const chat = manager.createChat("project-1", "user-1");
      const chatId = chat.runtime.chatId;
      manager.deleteChat(chatId);

      expect(manager.getChat(chatId)).toBeNull();
    });
  });

  describe("sidebar data generation", () => {
    it("groups chats by project in sidebar", () => {
      manager.createChat("project-1", "user-1");
      manager.createChat("project-1", "user-1");
      manager.createChat("project-2", "user-1");

      const sidebar = manager.getSidebarData("user-1");
      expect(sidebar.projectGroups.length).toBe(2);
    });

    it("filters sidebar by user", () => {
      manager.createChat("project-1", "alice");
      manager.createChat("project-1", "bob");

      const aliceSidebar = manager.getSidebarData("alice");
      const bobSidebar = manager.getSidebarData("bob");

      expect(aliceSidebar.projectGroups[0].chats.length).toBe(1);
      expect(bobSidebar.projectGroups[0].chats.length).toBe(1);
    });
  });
});
