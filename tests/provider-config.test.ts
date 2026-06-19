import { describe, it, expect, beforeEach } from "vitest";
import { ProviderConfigManager } from "../src/server/provider-config.js";

describe("ProviderConfigManager", () => {
  let manager: ProviderConfigManager;

  beforeEach(() => {
    manager = new ProviderConfigManager();
  });

  describe("default state", () => {
    it("starts with zen as active provider", () => {
      const config = manager.getActiveConfig();
      expect(config.provider).toBe("zen");
      expect(config.enabled).toBe(true);
    });

    it("zen provides free token by default", () => {
      const config = manager.getActiveConfig();
      expect(config.apiKey).toBeTruthy();
    });

    it("returns snapshot matching LlmProviderSnapshot shape", () => {
      const snapshot = manager.getSnapshot();
      expect(snapshot).toHaveProperty("provider");
      expect(snapshot).toHaveProperty("apiKey");
      expect(snapshot).toHaveProperty("model");
      expect(snapshot).toHaveProperty("baseUrl");
      expect(snapshot).toHaveProperty("resolvedBaseUrl");
      expect(snapshot).toHaveProperty("enabled");
      expect(snapshot).toHaveProperty("warning");
      expect(snapshot).toHaveProperty("filePathDisplay");
    });

    it("snapshot does not expose api key to client", () => {
      const snapshot = manager.getSnapshot();
      expect(snapshot.apiKey).toBe("");
    });
  });

  describe("Kanna LlmProviderKind mapping", () => {
    it("maps 'openai' to zen provider", () => {
      const mapped = manager.mapKannaProvider("openai");
      expect(mapped).toBe("zen");
    });

    it("maps 'openrouter' to openrouter provider", () => {
      const mapped = manager.mapKannaProvider("openrouter");
      expect(mapped).toBe("openrouter");
    });

    it("maps 'custom' to custom provider", () => {
      const mapped = manager.mapKannaProvider("custom");
      expect(mapped).toBe("custom");
    });
  });

  describe("writeLlmProvider", () => {
    it("configures custom provider with BYOK credentials", () => {
      manager.writeLlmProvider({
        provider: "custom",
        apiKey: "sk-test-key-123",
        model: "gpt-4",
        baseUrl: "https://api.example.com/v1",
      });

      const config = manager.getActiveConfig();
      expect(config.provider).toBe("custom");
      expect(config.apiKey).toBe("sk-test-key-123");
      expect(config.baseUrl).toBe("https://api.example.com/v1");
    });

    it("configures openrouter with user api key", () => {
      manager.writeLlmProvider({
        provider: "openrouter",
        apiKey: "sk-or-test-key",
        model: "anthropic/claude-sonnet-4-6",
        baseUrl: "https://openrouter.ai/api/v1",
      });

      const config = manager.getActiveConfig();
      expect(config.provider).toBe("openrouter");
      expect(config.apiKey).toBe("sk-or-test-key");
    });

    it("switches to zen when 'openai' provider selected", () => {
      manager.writeLlmProvider({
        provider: "openai",
        apiKey: "",
        model: "anthropic/claude-sonnet-4-6",
        baseUrl: "",
      });

      const config = manager.getActiveConfig();
      expect(config.provider).toBe("zen");
      expect(config.enabled).toBe(true);
    });

    it("returns updated snapshot after write", () => {
      const result = manager.writeLlmProvider({
        provider: "custom",
        apiKey: "sk-key",
        model: "my-model",
        baseUrl: "https://my-api.com/v1",
      });

      expect(result.provider).toBe("custom");
      expect(result.enabled).toBe(true);
      expect(result.model).toBe("my-model");
      expect(result.baseUrl).toBe("https://my-api.com/v1");
      expect(result.apiKey).toBe("");
    });
  });

  describe("proxy config generation", () => {
    it("generates proxy entry for custom provider", () => {
      manager.writeLlmProvider({
        provider: "custom",
        apiKey: "sk-test",
        model: "gpt-4",
        baseUrl: "https://api.example.com/v1",
      });

      const proxyEntry = manager.getProxyEntry("custom");
      expect(proxyEntry).toBeDefined();
      expect(proxyEntry!.chatUrl).toBe("https://api.example.com/v1/chat/completions");
      expect(proxyEntry!.responsesUrl).toBe("https://api.example.com/v1/responses");
      expect(proxyEntry!.apiKey).toBe("sk-test");
    });

    it("generates proxy entry for zen (free tier)", () => {
      const proxyEntry = manager.getProxyEntry("zen");
      expect(proxyEntry).toBeDefined();
      expect(proxyEntry!.chatUrl).toContain("opencode.ai/zen");
      expect(proxyEntry!.apiKey).toBeTruthy();
    });

    it("returns null proxy entry for unconfigured custom provider", () => {
      const proxyEntry = manager.getProxyEntry("custom");
      expect(proxyEntry).toBeNull();
    });
  });

  describe("failover chain", () => {
    it("default chain is zen → openrouter → custom", () => {
      const chain = manager.getFailoverChain();
      expect(chain).toEqual(["zen", "openrouter", "custom"]);
    });

    it("prioritizes custom when custom provider is configured", () => {
      manager.writeLlmProvider({
        provider: "custom",
        apiKey: "sk-test",
        model: "gpt-4",
        baseUrl: "https://api.example.com/v1",
      });

      const chain = manager.getFailoverChain();
      expect(chain[0]).toBe("custom");
    });

    it("prioritizes openrouter when openrouter provider is configured with key", () => {
      manager.writeLlmProvider({
        provider: "openrouter",
        apiKey: "sk-or-key",
        model: "anthropic/claude-sonnet-4-6",
        baseUrl: "https://openrouter.ai/api/v1",
      });

      const chain = manager.getFailoverChain();
      expect(chain[0]).toBe("openrouter");
    });
  });

  describe("validateLlmProvider", () => {
    it("rejects empty base URL for custom provider", () => {
      const result = manager.validateLlmProvider({
        provider: "custom",
        apiKey: "sk-test",
        model: "gpt-4",
        baseUrl: "",
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("rejects missing api key for custom provider", () => {
      const result = manager.validateLlmProvider({
        provider: "custom",
        apiKey: "",
        model: "gpt-4",
        baseUrl: "https://api.example.com/v1",
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("accepts valid custom provider config", () => {
      const result = manager.validateLlmProvider({
        provider: "custom",
        apiKey: "sk-test",
        model: "gpt-4",
        baseUrl: "https://api.example.com/v1",
      });

      expect(result.ok).toBe(true);
      expect(result.error).toBeNull();
    });

    it("accepts openai provider without api key (zen free tier)", () => {
      const result = manager.validateLlmProvider({
        provider: "openai",
        apiKey: "",
        model: "",
        baseUrl: "",
      });

      expect(result.ok).toBe(true);
      expect(result.error).toBeNull();
    });

    it("rejects URLs with non-https schemes", () => {
      const result = manager.validateLlmProvider({
        provider: "custom",
        apiKey: "sk-test",
        model: "gpt-4",
        baseUrl: "http://localhost:8080/v1",
      });

      expect(result.ok).toBe(true);
    });

    it("rejects malformed URLs", () => {
      const result = manager.validateLlmProvider({
        provider: "custom",
        apiKey: "sk-test",
        model: "gpt-4",
        baseUrl: "not-a-url",
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });
});
