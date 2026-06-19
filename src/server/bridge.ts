import { EventEmitter } from "events";
import type { Notification, JsonRpcRequest, JsonRpcResponse } from "@/types";

let rpcIdCounter = 0;

interface PendingCall {
  resolve: (value: JsonRpcResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class OpenCodeBridge extends EventEmitter {
  private baseUrl: string;
  private ws: WebSocket | null = null;
  private pendingCalls = new Map<number, PendingCall>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;

  constructor(baseUrl = "http://127.0.0.1:4096") {
    super();
    this.baseUrl = baseUrl;
  }

  async start(): Promise<void> {
    try {
      const healthRes = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (healthRes.ok) {
        this.connected = true;
        this.emit("connected");
        return;
      }
    } catch {
      // OpenCode server not running, attempt to start it
    }

    await this.spawnOpenCode();
  }

  private async spawnOpenCode(): Promise<void> {
    try {
      const { createOpencodeServer } = await import("@opencode-ai/sdk");
      const server = await createOpencodeServer({
        port: 4096,
        hostname: "127.0.0.1",
        timeout: 10000,
      });
      this.baseUrl = server.url;
      this.connected = true;
      this.emit("connected");
    } catch (err) {
      this.emit("error", new Error(`Failed to start OpenCode: ${err}`));
    }
  }

  async rpc(method: string, params?: unknown): Promise<unknown> {
    const id = ++rpcIdCounter;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    const res = await fetch(`${this.baseUrl}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (!res.ok) {
      throw new Error(`RPC ${method} failed: ${res.status} ${res.statusText}`);
    }

    const response = (await res.json()) as JsonRpcResponse;
    if (response.error) {
      throw new Error(`RPC ${method} error: ${response.error.message}`);
    }

    return response.result;
  }

  async rpcStream(
    method: string,
    params: unknown,
    onDelta: (data: unknown) => void,
  ): Promise<unknown> {
    const id = ++rpcIdCounter;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    const res = await fetch(`${this.baseUrl}/rpc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(request),
    });

    if (!res.ok) {
      throw new Error(
        `RPC stream ${method} failed: ${res.status} ${res.statusText}`,
      );
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body for streaming");

    const decoder = new TextDecoder();
    let buffer = "";
    let finalResult: unknown = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "delta") {
              onDelta(parsed.data);
            } else if (parsed.type === "complete") {
              finalResult = parsed.data;
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }
    }

    return finalResult;
  }

  connectWebSocket(
    onNotification: (notification: Notification) => void,
  ): void {
    const wsUrl = this.baseUrl.replace(/^http/, "ws") + "/ws";
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.emit("ws:connected");
    };

    this.ws.onmessage = (event) => {
      try {
        const notification = JSON.parse(
          event.data as string,
        ) as Notification;
        onNotification(notification);
      } catch {
        // skip malformed messages
      }
    };

    this.ws.onclose = () => {
      this.emit("ws:disconnected");
      this.scheduleReconnect(onNotification);
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private scheduleReconnect(
    onNotification: (notification: Notification) => void,
  ): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectWebSocket(onNotification);
    }, 3000);
  }

  async listSessions(): Promise<unknown> {
    return this.rpc("session.list");
  }

  async createSession(
    projectPath: string,
    modelId?: string,
  ): Promise<unknown> {
    return this.rpc("session.create", { projectPath, modelId });
  }

  async sendMessage(
    sessionId: string,
    content: string,
    onDelta: (data: unknown) => void,
  ): Promise<unknown> {
    return this.rpcStream(
      "session.chat",
      { sessionId, content },
      onDelta,
    );
  }

  async abortGeneration(sessionId: string): Promise<void> {
    await this.rpc("session.abort", { sessionId });
  }

  async listModels(): Promise<unknown> {
    return this.rpc("model.list");
  }

  async respondToRequest(
    requestId: string,
    approved: boolean,
  ): Promise<void> {
    await this.rpc("server_request.respond", {
      requestId,
      approved,
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  async close(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.connected = false;
  }
}
