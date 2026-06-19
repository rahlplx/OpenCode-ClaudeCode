import type { ProviderType } from "../types/index.js";
import { getZenConfig, buildZenHeaders } from "../providers/zen.js";
import { getOpenRouterConfig } from "../providers/openrouter.js";

type LlmProviderKind = "openai" | "openrouter" | "custom";

const BLOCKED_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^localhost$/i,
  /^\[::1\]$/,
  /^\[fc/i,
  /^\[fd/i,
  /^\[fe80:/i,
];

function isBlockedUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname;
    if (BLOCKED_IP_PATTERNS.some((p) => p.test(hostname))) return true;
    if (!["https:", "http:"].includes(url.protocol)) return true;
    return false;
  } catch {
    return true;
  }
}

interface LlmProviderWrite {
  provider: LlmProviderKind;
  apiKey: string;
  model: string;
  baseUrl: string;
}

interface LlmProviderSnapshot {
  provider: LlmProviderKind;
  apiKey: string;
  model: string;
  baseUrl: string;
  resolvedBaseUrl: string;
  enabled: boolean;
  warning: string | null;
  filePathDisplay: string;
}

interface ProxyEntry {
  responsesUrl: string;
  chatUrl: string;
  apiKey: string;
  wireApi: "responses" | "chat";
  buildHeaders: (token: string) => Record<string, string>;
}

interface ActiveConfig {
  provider: ProviderType;
  apiKey: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
}

const KANNA_TO_SERVER: Record<LlmProviderKind, ProviderType> = {
  openai: "zen",
  openrouter: "openrouter",
  custom: "custom",
};

export class ProviderConfigManager {
  private currentProvider: LlmProviderKind = "openai";
  private customApiKey = "";
  private customModel = "";
  private customBaseUrl = "";

  mapKannaProvider(kannaProvider: LlmProviderKind): ProviderType {
    return KANNA_TO_SERVER[kannaProvider] ?? "custom";
  }

  getActiveConfig(): ActiveConfig {
    const serverProvider = this.mapKannaProvider(this.currentProvider);

    switch (serverProvider) {
      case "zen": {
        const zen = getZenConfig();
        return {
          provider: "zen",
          apiKey: zen.apiKey!,
          baseUrl: zen.baseUrl,
          model: "anthropic/claude-sonnet-4-6",
          enabled: true,
        };
      }
      case "openrouter": {
        const or = getOpenRouterConfig(this.customApiKey || undefined);
        return {
          provider: "openrouter",
          apiKey: this.customApiKey || or.apiKey || "",
          baseUrl: or.baseUrl,
          model: this.customModel || "anthropic/claude-sonnet-4-6",
          enabled: true,
        };
      }
      case "custom":
        return {
          provider: "custom",
          apiKey: this.customApiKey,
          baseUrl: this.customBaseUrl,
          model: this.customModel,
          enabled: Boolean(this.customApiKey && this.customBaseUrl),
        };
    }
  }

  getSnapshot(): LlmProviderSnapshot {
    const active = this.getActiveConfig();
    return {
      provider: this.currentProvider,
      apiKey: "",
      model: active.model,
      baseUrl: this.currentProvider === "custom" ? this.customBaseUrl : "",
      resolvedBaseUrl: active.baseUrl,
      enabled: active.enabled,
      warning: null,
      filePathDisplay: "~/.opencode/llm-provider.json",
    };
  }

  writeLlmProvider(config: LlmProviderWrite): LlmProviderSnapshot {
    this.currentProvider = config.provider;
    this.customApiKey = config.apiKey;
    this.customModel = config.model;
    this.customBaseUrl = config.baseUrl;

    return this.getSnapshot();
  }

  validateLlmProvider(config: LlmProviderWrite): { ok: boolean; error: string | null } {
    const serverProvider = this.mapKannaProvider(config.provider);

    if (serverProvider === "zen") {
      return { ok: true, error: null };
    }

    if (serverProvider === "openrouter") {
      return { ok: true, error: null };
    }

    if (!config.apiKey) {
      return { ok: false, error: "API key is required for custom providers" };
    }
    if (!config.baseUrl) {
      return { ok: false, error: "Base URL is required for custom providers" };
    }

    try {
      new URL(config.baseUrl);
    } catch {
      return { ok: false, error: "Invalid base URL format" };
    }

    if (isBlockedUrl(config.baseUrl)) {
      return { ok: false, error: "Base URL must not target internal or private networks" };
    }

    return { ok: true, error: null };
  }

  getProxyEntry(providerType: ProviderType): ProxyEntry | null {
    switch (providerType) {
      case "zen": {
        const zen = getZenConfig();
        return {
          responsesUrl: `${zen.baseUrl}/responses`,
          chatUrl: `${zen.baseUrl}/chat/completions`,
          apiKey: zen.apiKey!,
          wireApi: "chat",
          buildHeaders: buildZenHeaders,
        };
      }
      case "openrouter": {
        const or = getOpenRouterConfig(this.customApiKey || undefined);
        if (!or.apiKey && this.currentProvider !== "openrouter") {
          return {
            responsesUrl: `${or.baseUrl}/responses`,
            chatUrl: `${or.baseUrl}/chat/completions`,
            apiKey: "",
            wireApi: "responses",
            buildHeaders: (token: string) => ({
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://github.com/opencode-claudecode",
              "X-Title": "OpenCode-ClaudeCode",
            }),
          };
        }
        return {
          responsesUrl: `${or.baseUrl}/responses`,
          chatUrl: `${or.baseUrl}/chat/completions`,
          apiKey: this.currentProvider === "openrouter" ? this.customApiKey : (or.apiKey || ""),
          wireApi: "responses",
          buildHeaders: (token: string) => ({
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/opencode-claudecode",
            "X-Title": "OpenCode-ClaudeCode",
          }),
        };
      }
      case "custom": {
        if (!this.customApiKey || !this.customBaseUrl) return null;
        if (isBlockedUrl(this.customBaseUrl)) return null;
        return {
          responsesUrl: `${this.customBaseUrl}/responses`,
          chatUrl: `${this.customBaseUrl}/chat/completions`,
          apiKey: this.customApiKey,
          wireApi: "chat",
          buildHeaders: (token: string) => ({
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          }),
        };
      }
    }
  }

  getFailoverChain(): ProviderType[] {
    const serverProvider = this.mapKannaProvider(this.currentProvider);

    if (serverProvider === "custom" && this.customApiKey && this.customBaseUrl) {
      return ["custom", "zen", "openrouter"];
    }
    if (serverProvider === "openrouter" && this.customApiKey) {
      return ["openrouter", "zen", "custom"];
    }

    return ["zen", "openrouter", "custom"];
  }
}
