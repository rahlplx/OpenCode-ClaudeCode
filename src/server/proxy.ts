import type { IncomingMessage, ServerResponse } from "http";
import type { ProviderType } from "@/types";

interface ProxyConfig {
  providers: Record<
    ProviderType,
    {
      responsesUrl: string;
      chatUrl: string;
      apiKey?: string;
      wireApi: "responses" | "chat";
      buildHeaders: (token: string) => Record<string, string>;
    }
  >;
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface ChatCompletionsRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  tools?: unknown[];
  tool_choice?: unknown;
}

export function responsesInputToMessages(
  input: unknown[],
  instructions?: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  if (instructions) {
    messages.push({ role: "system", content: instructions });
  }

  for (const item of input) {
    const entry = item as Record<string, unknown>;
    if (typeof entry === "string") {
      messages.push({ role: "user", content: entry as string });
      continue;
    }

    switch (entry.role) {
      case "user":
        messages.push({
          role: "user",
          content: extractTextContent(entry.content),
        });
        break;
      case "assistant":
        messages.push({
          role: "assistant",
          content: extractTextContent(entry.content),
        });
        break;
      case "developer":
      case "system":
        messages.push({
          role: "system",
          content: extractTextContent(entry.content),
        });
        break;
      case "tool":
        messages.push({
          role: "tool",
          content: extractTextContent(entry.output ?? entry.content),
          tool_call_id: entry.call_id as string,
        });
        break;
    }

    if (entry.type === "function_call") {
      messages.push({
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: entry.call_id as string,
            type: "function",
            function: {
              name: entry.name as string,
              arguments: entry.arguments as string,
            },
          },
        ],
      });
    }
  }

  return messages;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (p: Record<string, unknown>) =>
          p.type === "text" || p.type === "input_text" || p.type === "output_text",
      )
      .map((p: Record<string, unknown>) => p.text || "")
      .join("");
  }
  return String(content ?? "");
}

export function responsesToChatCompletions(
  body: Record<string, unknown>,
): ChatCompletionsRequest {
  const messages = responsesInputToMessages(
    (body.input as unknown[]) || [],
    body.instructions as string | undefined,
  );

  const request: ChatCompletionsRequest = {
    model: body.model as string,
    messages,
    stream: body.stream as boolean | undefined,
  };

  if (body.max_output_tokens) {
    request.max_tokens = body.max_output_tokens as number;
  }
  if (body.temperature !== undefined) {
    request.temperature = body.temperature as number;
  }
  if (body.tools) {
    const tools = (body.tools as Array<Record<string, unknown>>)
      .filter((t) => t.type === "function")
      .map((t) => ({
        type: "function" as const,
        function: {
          name: t.name as string,
          description: t.description as string,
          parameters: t.parameters,
        },
      }));
    if (tools.length > 0) request.tools = tools;
  }

  return request;
}

export function chatCompletionsToResponses(
  chatResponse: Record<string, unknown>,
): Record<string, unknown> {
  const choices = (chatResponse.choices as Array<Record<string, unknown>>) || [];
  const output: unknown[] = [];

  for (const choice of choices) {
    const message = choice.message as Record<string, unknown>;
    if (!message) continue;

    if (message.content) {
      output.push({
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: message.content }],
      });
    }

    const toolCalls = message.tool_calls as Array<Record<string, unknown>>;
    if (toolCalls) {
      for (const tc of toolCalls) {
        const fn = tc.function as Record<string, unknown>;
        output.push({
          type: "function_call",
          call_id: tc.id,
          name: fn.name,
          arguments: fn.arguments,
        });
      }
    }
  }

  const usage = chatResponse.usage as Record<string, number> | undefined;
  return {
    id: chatResponse.id,
    output,
    usage: usage
      ? {
          input_tokens: usage.prompt_tokens,
          output_tokens: usage.completion_tokens,
          total_tokens: usage.total_tokens,
        }
      : undefined,
  };
}

export async function handleProviderProxy(
  req: IncomingMessage,
  res: ServerResponse,
  providerType: ProviderType,
  config: ProxyConfig,
): Promise<void> {
  const provider = config.providers[providerType];
  if (!provider) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Unknown provider: ${providerType}` }));
    return;
  }

  const body = await readRequestBody(req);
  let parsedBody: Record<string, unknown>;
  try {
    parsedBody = JSON.parse(body);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON body" }));
    return;
  }

  const apiKey = provider.apiKey;
  if (!apiKey) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: `No API key configured for ${providerType}`,
      }),
    );
    return;
  }

  let upstreamUrl: string;
  let upstreamBody: unknown;

  if (provider.wireApi === "chat") {
    upstreamUrl = provider.chatUrl;
    upstreamBody = responsesToChatCompletions(parsedBody);
  } else {
    upstreamUrl = provider.responsesUrl;
    upstreamBody = parsedBody;
  }

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      method: "POST",
      headers: provider.buildHeaders(apiKey),
      body: JSON.stringify(upstreamBody),
    });

    if (!upstreamRes.ok) {
      const errorText = await upstreamRes.text();
      const statusCode = upstreamRes.status;

      if (statusCode === 429) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Rate limited",
            provider: providerType,
            retryAfter: upstreamRes.headers.get("retry-after"),
          }),
        );
        return;
      }

      res.writeHead(statusCode, { "Content-Type": "application/json" });
      try {
        res.end(errorText);
      } catch {
        res.end(JSON.stringify({ error: errorText }));
      }
      return;
    }

    if (parsedBody.stream && upstreamRes.body) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const reader = upstreamRes.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });

        if (provider.wireApi === "chat") {
          res.write(convertStreamChunkToResponses(chunk));
        } else {
          res.write(chunk);
        }
      }
      res.end();
    } else {
      const responseJson = (await upstreamRes.json()) as Record<string, unknown>;
      let result: Record<string, unknown>;

      if (provider.wireApi === "chat") {
        result = chatCompletionsToResponses(responseJson);
      } else {
        result = responseJson;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    }
  } catch (err) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: `Proxy error: ${err instanceof Error ? err.message : String(err)}`,
      }),
    );
  }
}

function convertStreamChunkToResponses(chunk: string): string {
  const lines = chunk.split("\n");
  let output = "";

  for (const line of lines) {
    if (!line.startsWith("data: ")) {
      output += line + "\n";
      continue;
    }

    const data = line.slice(6).trim();
    if (data === "[DONE]") {
      output += "data: [DONE]\n\n";
      continue;
    }

    try {
      const parsed = JSON.parse(data) as Record<string, unknown>;
      const choices = parsed.choices as Array<Record<string, unknown>>;
      if (!choices?.[0]) {
        output += line + "\n";
        continue;
      }

      const delta = choices[0].delta as Record<string, unknown>;
      if (delta?.content) {
        output += `data: ${JSON.stringify({
          type: "response.output_text.delta",
          delta: delta.content,
        })}\n\n`;
      }
    } catch {
      output += line + "\n";
    }
  }

  return output;
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}
