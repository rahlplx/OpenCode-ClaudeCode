import type { ProviderConfig, Model } from "@/types";
import { randomBytes } from "crypto";

const ZEN_PUBLIC_TOKEN = "zen-public-fallback";

function generateId(prefix: string): string {
  const alphabet =
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const bytes = randomBytes(16);
  let id = prefix;
  for (const b of bytes) {
    id += alphabet[b % alphabet.length];
  }
  return id;
}

const zenSessionId = generateId("ses");

export function getZenConfig(apiKey?: string): ProviderConfig {
  return {
    type: "zen",
    baseUrl: "https://opencode.ai/zen/v1",
    apiKey: apiKey || ZEN_PUBLIC_TOKEN,
    wireApi: "chat",
  };
}

export function buildZenHeaders(bearerToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${bearerToken}`,
    "Content-Type": "application/json",
    "User-Agent": "opencode-cli/1.15.9",
    "x-opencode-client": "cli",
    "x-opencode-request-id": generateId("msg"),
    "x-opencode-session-id": zenSessionId,
  };
}

export function getZenModels(): Model[] {
  return [
    {
      id: "anthropic/claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
      provider: "zen",
      isFree: true,
      contextWindow: 200000,
    },
    {
      id: "anthropic/claude-haiku-4-5",
      name: "Claude Haiku 4.5",
      provider: "zen",
      isFree: true,
      contextWindow: 200000,
    },
    {
      id: "openai/gpt-4.1-mini",
      name: "GPT-4.1 Mini",
      provider: "zen",
      isFree: true,
      contextWindow: 128000,
    },
  ];
}
