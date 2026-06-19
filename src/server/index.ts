import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { OpenCodeBridge } from "./bridge.js";
import { handleProviderProxy } from "./proxy.js";
import { handleLogin, requireAuth, generatePassword } from "./auth.js";
import { getZenConfig, buildZenHeaders } from "../providers/zen.js";
import { getOpenRouterConfig, fetchFreeModels } from "../providers/openrouter.js";
import type { ProviderType, Notification, Model } from "../types/index.js";

interface ServerOptions {
  port?: number;
  host?: string;
  password?: string;
  noPassword?: boolean;
  opencodePath?: string;
  staticDir?: string;
}

export async function startServer(options: ServerOptions = {}): Promise<void> {
  const port = options.port || 4080;
  const host = options.host || "0.0.0.0";
  const noPassword = options.noPassword ?? true;
  const password = options.password || generatePassword();

  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: "/api/ws" });

  const bridge = new OpenCodeBridge();
  const clients = new Set<WebSocket>();

  function broadcast(notification: Notification): void {
    const data = JSON.stringify(notification);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: "connected", data: { ready: true } }));

    ws.on("close", () => {
      clients.delete(ws);
    });
  });

  app.use(express.json({ limit: "10mb" }));

  app.post("/api/auth/login", (req, res) => {
    handleLogin(req, res, password);
  });

  app.use("/api", (req, res, next) => {
    if (req.path === "/auth/login" || req.path === "/health") {
      next();
      return;
    }
    if (requireAuth(req, res, noPassword)) {
      next();
    }
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      opencode: bridge.isConnected(),
      version: process.env.npm_package_version || "0.1.0",
    });
  });

  app.post("/api/rpc", async (req, res) => {
    try {
      const { method, params } = req.body as {
        method: string;
        params?: unknown;
      };

      if (req.headers.accept === "text/event-stream") {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders();

        const result = await bridge.rpcStream(
          method,
          params,
          (delta: unknown) => {
            res.write(`data: ${JSON.stringify({ type: "delta", data: delta })}\n\n`);
            broadcast({
              type: "message.delta",
              data: delta,
              sessionId: (params as Record<string, string>)?.sessionId,
            });
          },
        );

        res.write(`data: ${JSON.stringify({ type: "complete", data: result })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        const result = await bridge.rpc(method, params);
        res.json({ jsonrpc: "2.0", id: 1, result });
      }
    } catch (err) {
      res.status(500).json({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  });

  app.get("/api/models", async (_req, res) => {
    try {
      const [zenModels, freeModels] = await Promise.allSettled([
        Promise.resolve(
          (await import("../providers/zen.js")).getZenModels(),
        ),
        fetchFreeModels(),
      ]);

      const models: Model[] = [];
      if (zenModels.status === "fulfilled") models.push(...zenModels.value);
      if (freeModels.status === "fulfilled") models.push(...freeModels.value);

      res.json({ models });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  const proxyConfig = {
    providers: {
      zen: {
        responsesUrl: "https://opencode.ai/zen/v1/responses",
        chatUrl: "https://opencode.ai/zen/v1/chat/completions",
        apiKey: getZenConfig().apiKey,
        wireApi: "chat" as const,
        buildHeaders: buildZenHeaders,
      },
      openrouter: {
        responsesUrl: "https://openrouter.ai/api/v1/responses",
        chatUrl: "https://openrouter.ai/api/v1/chat/completions",
        apiKey: getOpenRouterConfig().apiKey,
        wireApi: "responses" as const,
        buildHeaders: (token: string) => ({
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/opencode-claudecode",
          "X-Title": "OpenCode-ClaudeCode",
        }),
      },
      custom: {
        responsesUrl: "",
        chatUrl: "",
        apiKey: undefined,
        wireApi: "chat" as const,
        buildHeaders: (token: string) => ({
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        }),
      },
    },
  };

  app.post("/api/proxy/:provider/v1/responses", (req, res) => {
    const provider = req.params.provider as ProviderType;
    handleProviderProxy(req, res, provider, proxyConfig);
  });

  app.post("/api/server-requests/respond", async (req, res) => {
    try {
      const { requestId, approved } = req.body as {
        requestId: string;
        approved: boolean;
      };
      await bridge.respondToRequest(requestId, approved);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  if (options.staticDir) {
    app.use(express.static(options.staticDir));
    app.get("*", (_req, res) => {
      res.sendFile("index.html", { root: options.staticDir });
    });
  }

  bridge.on("connected", () => {
    console.log("OpenCode backend connected");
    bridge.connectWebSocket(broadcast);
  });

  bridge.on("error", (err: Error) => {
    console.error("OpenCode bridge error:", err.message);
  });

  try {
    await bridge.start();
  } catch (err) {
    console.warn(
      "OpenCode not available, running in proxy-only mode:",
      err instanceof Error ? err.message : String(err),
    );
  }

  server.listen(port, host, () => {
    console.log(`OpenCode-ClaudeCode server running at http://${host}:${port}`);
    if (!noPassword) {
      console.log(`Password: ${password}`);
    }
  });
}
