import type {
  Session,
  Message,
  Model,
  Notification,
  ServerRequest,
} from "@/types";

const BASE_URL = "/api";

async function rpc<T>(method: string, params?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(
      (error as { error?: { message?: string } }).error?.message || "RPC failed",
    );
  }

  const json = (await res.json()) as { result: T; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

async function rpcStream(
  method: string,
  params: unknown,
  onDelta: (text: string) => void,
): Promise<Message> {
  const res = await fetch(`${BASE_URL}/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ method, params }),
  });

  if (!res.ok) {
    throw new Error(`Stream failed: ${res.statusText}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response stream");

  const decoder = new TextDecoder();
  let buffer = "";
  let result: Message | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;

      try {
        const parsed = JSON.parse(data) as { type: string; data: unknown };
        if (parsed.type === "delta") {
          const delta = parsed.data as { text?: string; content?: string };
          onDelta(delta.text || delta.content || "");
        } else if (parsed.type === "complete") {
          result = parsed.data as Message;
        }
      } catch {
        // skip malformed chunks
      }
    }
  }

  if (!result) throw new Error("Stream ended without completion");
  return result;
}

export const api = {
  async listSessions(): Promise<Session[]> {
    return rpc<Session[]>("session.list");
  },

  async createSession(projectPath: string, modelId?: string): Promise<Session> {
    return rpc<Session>("session.create", { projectPath, modelId });
  },

  async sendMessage(
    sessionId: string,
    content: string,
    onDelta: (text: string) => void,
  ): Promise<Message> {
    return rpcStream("session.chat", { sessionId, content }, onDelta);
  },

  async abortGeneration(sessionId: string): Promise<void> {
    await rpc<void>("session.abort", { sessionId });
  },

  async listModels(): Promise<Model[]> {
    const res = await fetch(`${BASE_URL}/models`);
    const json = (await res.json()) as { models: Model[] };
    return json.models;
  },

  async respondToServerRequest(
    requestId: string,
    approved: boolean,
  ): Promise<void> {
    await fetch(`${BASE_URL}/server-requests/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, approved }),
    });
  },

  async login(password: string): Promise<boolean> {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    return res.ok;
  },

  async healthCheck(): Promise<{
    status: string;
    opencode: boolean;
    version: string;
  }> {
    const res = await fetch(`${BASE_URL}/health`);
    return res.json() as Promise<{
      status: string;
      opencode: boolean;
      version: string;
    }>;
  },

  connectWebSocket(
    onNotification: (notification: Notification) => void,
  ): WebSocket {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws`);

    ws.onmessage = (event) => {
      try {
        const notification = JSON.parse(event.data) as Notification;
        onNotification(notification);
      } catch {
        // skip malformed messages
      }
    };

    return ws;
  },
};
