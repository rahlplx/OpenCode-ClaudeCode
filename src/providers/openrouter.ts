import type { ProviderConfig, Model } from "@/types";

const OPENROUTER_RESPONSES_URL = "https://openrouter.ai/api/v1/responses";
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

const ALLOWED_TOOL_TYPES = new Set([
  "function",
  "openrouter:datetime",
  "openrouter:image_generation",
  "openrouter:web_search",
]);

const FALLBACK_FREE_MODELS: Model[] = [
  {
    id: "google/gemma-3-4b-it:free",
    name: "Gemma 3 4B",
    provider: "openrouter",
    isFree: true,
  },
  {
    id: "meta-llama/llama-3.3-8b-instruct:free",
    name: "Llama 3.3 8B",
    provider: "openrouter",
    isFree: true,
  },
  {
    id: "qwen/qwen3-4b:free",
    name: "Qwen 3 4B",
    provider: "openrouter",
    isFree: true,
  },
];

let cachedModels: Model[] | null = null;
let cacheExpiry = 0;
const CACHE_TTL = 10 * 60 * 1000;

export function getOpenRouterConfig(apiKey?: string): ProviderConfig {
  return {
    type: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey,
    wireApi: "responses",
  };
}

export function sanitizeTools(
  tools: Array<{ type: string; [k: string]: unknown }> | undefined,
): Array<{ type: string; [k: string]: unknown }> | undefined {
  if (!tools) return undefined;
  const filtered = tools.filter((t) => ALLOWED_TOOL_TYPES.has(t.type));
  return filtered.length > 0 ? filtered : undefined;
}

export async function fetchFreeModels(
  apiKey?: string,
): Promise<Model[]> {
  const now = Date.now();
  if (cachedModels && now < cacheExpiry) return cachedModels;

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const res = await fetch(OPENROUTER_MODELS_URL, { headers });
    if (!res.ok) return FALLBACK_FREE_MODELS;

    const json = (await res.json()) as {
      data: Array<{ id: string; name: string; context_length?: number }>;
    };
    const freeModels = json.data
      .filter(
        (m) => m.id.endsWith(":free") || m.id.includes("openrouter/free"),
      )
      .map(
        (m): Model => ({
          id: m.id,
          name: m.name,
          provider: "openrouter",
          isFree: true,
          contextWindow: m.context_length,
        }),
      );

    cachedModels = freeModels.length > 0 ? freeModels : FALLBACK_FREE_MODELS;
    cacheExpiry = now + CACHE_TTL;
    return cachedModels;
  } catch {
    return FALLBACK_FREE_MODELS;
  }
}

export async function proxyOpenRouterRequest(
  body: Record<string, unknown>,
  bearerToken: string,
  wireApi: "responses" | "chat",
  streaming: boolean,
): Promise<Response> {
  const url = wireApi === "responses" ? OPENROUTER_RESPONSES_URL : OPENROUTER_CHAT_URL;

  if (body.tools) {
    body.tools = sanitizeTools(
      body.tools as Array<{ type: string; [k: string]: unknown }>,
    );
    if (!body.tools) delete body.tool_choice;
  }

  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/opencode-claudecode",
      "X-Title": "OpenCode-ClaudeCode",
    },
    body: JSON.stringify(body),
  });
}
