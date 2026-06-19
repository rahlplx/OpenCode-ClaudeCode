import { describe, it, expect, beforeEach } from "vitest";
import { ChatSessionManager } from "../src/server/chat-session-manager.js";
import { ProviderConfigManager } from "../src/server/provider-config.js";
import { CircuitBreaker } from "../src/server/circuit-breaker.js";
import {
  responsesInputToMessages,
  responsesToChatCompletions,
  chatCompletionsToResponses,
} from "../src/server/proxy.js";

describe("E2E simulation: Kanna → adapter → proxy → provider", () => {
  let chatManager: ChatSessionManager;
  let providerConfig: ProviderConfigManager;
  let circuitBreaker: CircuitBreaker;

  beforeEach(() => {
    chatManager = new ChatSessionManager();
    providerConfig = new ProviderConfigManager();
    circuitBreaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 60_000 });
  });

  describe("Zen free tier flow (Claude via OpenCode Zen)", () => {
    it("default config routes through Zen", () => {
      const config = providerConfig.getActiveConfig();
      expect(config.provider).toBe("zen");
      expect(config.enabled).toBe(true);
      expect(config.apiKey).toBeTruthy();
    });

    it("Zen proxy entry has correct endpoints", () => {
      const entry = providerConfig.getProxyEntry("zen");
      expect(entry).not.toBeNull();
      expect(entry!.chatUrl).toContain("opencode.ai/zen/v1/chat/completions");
      expect(entry!.responsesUrl).toContain("opencode.ai/zen/v1/responses");
      expect(entry!.wireApi).toBe("chat");
    });

    it("creates chat, sends message, and simulates Zen response", () => {
      const chat = chatManager.createChat("my-project", "user-1");
      expect(chat.runtime.status).toBe("idle");

      chatManager.addUserMessage(chat.runtime.chatId, "Explain async/await", "claude", "claude-sonnet-4-6");
      let snapshot = chatManager.getChat(chat.runtime.chatId)!;
      expect(snapshot.runtime.status).toBe("running");
      expect(snapshot.runtime.provider).toBe("claude");
      expect(snapshot.messages[0].kind).toBe("user_prompt");

      // Simulate Zen API response (Chat Completions format → convert to Responses)
      const zenResponse = {
        id: "chatcmpl-123",
        choices: [{
          message: { role: "assistant", content: "Async/await is a pattern for handling asynchronous operations..." },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 20, completion_tokens: 50, total_tokens: 70 },
      };

      const responsesFormat = chatCompletionsToResponses(zenResponse);
      expect(responsesFormat.output).toBeDefined();
      const output = responsesFormat.output as Array<Record<string, unknown>>;
      expect(output[0].type).toBe("message");

      chatManager.addAssistantText(chat.runtime.chatId, zenResponse.choices[0].message.content);
      chatManager.completeChat(chat.runtime.chatId, 1500);

      snapshot = chatManager.getChat(chat.runtime.chatId)!;
      expect(snapshot.runtime.status).toBe("idle");
      expect(snapshot.messages.length).toBe(3);
      expect(snapshot.messages[0].kind).toBe("user_prompt");
      expect(snapshot.messages[1].kind).toBe("assistant_text");
      expect(snapshot.messages[2].kind).toBe("result");
    });

    it("Zen is first in default failover chain", () => {
      const chain = providerConfig.getFailoverChain();
      expect(chain[0]).toBe("zen");
    });

    it("circuit breaker tracks Zen provider state", () => {
      expect(circuitBreaker.isAvailable("zen")).toBe(true);
      circuitBreaker.recordFailure("zen");
      circuitBreaker.recordFailure("zen");
      expect(circuitBreaker.isAvailable("zen")).toBe(true);
      circuitBreaker.recordFailure("zen");
      expect(circuitBreaker.isAvailable("zen")).toBe(false);
    });
  });

  describe("Claude API via SDK flow", () => {
    it("protocol translates Responses API input to Chat Completions", () => {
      const responsesInput = [
        { role: "user", content: [{ type: "input_text", text: "Write a function" }] },
      ];

      const messages = responsesInputToMessages(responsesInput, "You are a coding assistant");
      expect(messages[0].role).toBe("system");
      expect(messages[0].content).toBe("You are a coding assistant");
      expect(messages[1].role).toBe("user");
      expect(messages[1].content).toBe("Write a function");
    });

    it("protocol translates Chat Completions response to Responses API", () => {
      const chatResponse = {
        id: "chatcmpl-abc",
        choices: [{
          message: {
            role: "assistant",
            content: "Here's a function:\n```js\nfunction add(a, b) { return a + b; }\n```",
          },
        }],
        usage: { prompt_tokens: 10, completion_tokens: 30, total_tokens: 40 },
      };

      const result = chatCompletionsToResponses(chatResponse);
      expect(result.id).toBe("chatcmpl-abc");
      const output = result.output as Array<Record<string, unknown>>;
      expect(output[0].type).toBe("message");
      expect(result.usage).toEqual({
        input_tokens: 10,
        output_tokens: 30,
        total_tokens: 40,
      });
    });

    it("handles tool calls in responses translation", () => {
      const chatResponse = {
        id: "chatcmpl-tool",
        choices: [{
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: { name: "read_file", arguments: '{"path":"src/main.ts"}' },
            }],
          },
        }],
      };

      const result = chatCompletionsToResponses(chatResponse);
      const output = result.output as Array<Record<string, unknown>>;
      expect(output[0].type).toBe("function_call");
      expect(output[0].name).toBe("read_file");
      expect(output[0].call_id).toBe("call_1");
    });

    it("full request/response cycle through proxy translation", () => {
      const responsesRequest = {
        model: "anthropic/claude-sonnet-4-6",
        input: [
          { role: "user", content: "Fix this bug" },
        ],
        instructions: "You are a senior engineer",
        stream: false,
      };

      const chatCompletionsReq = responsesToChatCompletions(responsesRequest);
      expect(chatCompletionsReq.model).toBe("anthropic/claude-sonnet-4-6");
      expect(chatCompletionsReq.messages[0].role).toBe("system");
      expect(chatCompletionsReq.messages[0].content).toBe("You are a senior engineer");
      expect(chatCompletionsReq.messages[1].role).toBe("user");
      expect(chatCompletionsReq.messages[1].content).toBe("Fix this bug");
    });
  });

  describe("Codex API flow", () => {
    it("Codex models are in provider catalog", () => {
      const chat = chatManager.createChat("project-1", "user-1");
      const codex = chat.availableProviders.find((p) => p.id === "codex");
      expect(codex).toBeDefined();
      expect(codex!.label).toBe("Codex");
      expect(codex!.models.length).toBeGreaterThan(0);
      expect(codex!.defaultModel).toBe("gpt-5.5");
    });

    it("creates chat with codex provider", () => {
      const chat = chatManager.createChat("project-1", "user-1");
      chatManager.addUserMessage(chat.runtime.chatId, "Optimize this code", "codex", "gpt-5.5");

      const snapshot = chatManager.getChat(chat.runtime.chatId)!;
      expect(snapshot.runtime.provider).toBe("codex");
    });

    it("Codex can use custom BYOK endpoint", () => {
      providerConfig.writeLlmProvider({
        provider: "custom",
        apiKey: "sk-my-openai-key",
        model: "gpt-5.5",
        baseUrl: "https://api.openai.com/v1",
      });

      const entry = providerConfig.getProxyEntry("custom");
      expect(entry).not.toBeNull();
      expect(entry!.chatUrl).toBe("https://api.openai.com/v1/chat/completions");
      expect(entry!.apiKey).toBe("sk-my-openai-key");
    });
  });

  describe("BYOK (Bring Your Own Key) flow", () => {
    it("configures custom provider through settings", () => {
      const writeResult = providerConfig.writeLlmProvider({
        provider: "custom",
        apiKey: "sk-prod-key-123",
        model: "gpt-4-turbo",
        baseUrl: "https://api.mycompany.com/v1",
      });

      expect(writeResult.enabled).toBe(true);
      expect(writeResult.provider).toBe("custom");
      expect(writeResult.apiKey).toBe("");
    });

    it("custom provider becomes first in failover chain", () => {
      providerConfig.writeLlmProvider({
        provider: "custom",
        apiKey: "sk-key",
        model: "my-model",
        baseUrl: "https://api.external.com/v1",
      });

      const chain = providerConfig.getFailoverChain();
      expect(chain[0]).toBe("custom");
      expect(chain).toContain("zen");
    });

    it("validates BYOK config before saving", () => {
      const invalid = providerConfig.validateLlmProvider({
        provider: "custom",
        apiKey: "",
        model: "gpt-4",
        baseUrl: "https://api.example.com/v1",
      });
      expect(invalid.ok).toBe(false);

      const valid = providerConfig.validateLlmProvider({
        provider: "custom",
        apiKey: "sk-key",
        model: "gpt-4",
        baseUrl: "https://api.example.com/v1",
      });
      expect(valid.ok).toBe(true);
    });

    it("OpenRouter BYOK flow", () => {
      providerConfig.writeLlmProvider({
        provider: "openrouter",
        apiKey: "sk-or-my-key",
        model: "anthropic/claude-sonnet-4-6",
        baseUrl: "https://openrouter.ai/api/v1",
      });

      const config = providerConfig.getActiveConfig();
      expect(config.provider).toBe("openrouter");
      expect(config.apiKey).toBe("sk-or-my-key");

      const chain = providerConfig.getFailoverChain();
      expect(chain[0]).toBe("openrouter");
    });
  });

  describe("multi-tenant chat isolation", () => {
    it("users cannot see each other's chats in sidebar", () => {
      chatManager.createChat("project-shared", "alice");
      chatManager.createChat("project-shared", "bob");

      const aliceSidebar = chatManager.getSidebarData("alice");
      const bobSidebar = chatManager.getSidebarData("bob");

      expect(aliceSidebar.projectGroups[0].chats.length).toBe(1);
      expect(bobSidebar.projectGroups[0].chats.length).toBe(1);
    });

    it("cross-user chat access is denied", () => {
      const aliceChat = chatManager.createChat("project-1", "alice");
      expect(chatManager.canAccess(aliceChat.runtime.chatId, "bob")).toBe(false);
    });
  });

  describe("failover chain simulation", () => {
    it("falls through when Zen is down", () => {
      circuitBreaker.recordFailure("zen");
      circuitBreaker.recordFailure("zen");
      circuitBreaker.recordFailure("zen");

      expect(circuitBreaker.isAvailable("zen")).toBe(false);
      expect(circuitBreaker.isAvailable("openrouter")).toBe(true);

      const next = circuitBreaker.getNextProvider(["zen", "openrouter", "custom"]);
      expect(next).toBe("openrouter");
    });

    it("recovers Zen after reset timeout", () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1 });
      cb.recordFailure("zen");
      expect(cb.isAvailable("zen")).toBe(false);

      // After 1ms reset timeout, should recover
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(cb.isAvailable("zen")).toBe(true);
          resolve();
        }, 10);
      });
    });
  });
});
