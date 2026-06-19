import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { OpenCodeBridge } from "./bridge.js";
import { handleProviderProxy, circuitBreaker } from "./proxy.js";
import { handleLogin, requireAuth, generatePassword, getUserFromRequest, parseCookies, getUserIdFromToken, COOKIE_NAME } from "./auth.js";
import { getZenConfig, buildZenHeaders, getZenModels } from "../providers/zen.js";
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
  const clientsByUser = new Map<string, Set<WebSocket>>();
  const sessionOwnership = new Map<string, string>();
  const requestOwnership = new Map<string, string>();

  function broadcastToUser(userId: string, notification: Notification): void {
    const userClients = clientsByUser.get(userId);
    if (!userClients) return;
    const data = JSON.stringify(notification);
    for (const client of userClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  function broadcastToAll(notification: Notification): void {
    const data = JSON.stringify(notification);
    for (const [, userClients] of clientsByUser) {
      for (const client of userClients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data);
        }
      }
    }
  }

  wss.on("connection", (ws, req) => {
    const cookies = parseCookies(req.headers.cookie || "");
    const token = cookies[COOKIE_NAME];
    const userId = noPassword ? "default" : getUserIdFromToken(token);

    if (!userId) {
      ws.close(1008, "Unauthorized");
      return;
    }

    if (!clientsByUser.has(userId)) clientsByUser.set(userId, new Set());
    clientsByUser.get(userId)!.add(ws);

    ws.send(JSON.stringify({ type: "connected", data: { ready: true, userId } }));

    ws.on("close", () => {
      clientsByUser.get(userId)?.delete(ws);
      if (clientsByUser.get(userId)?.size === 0) {
        clientsByUser.delete(userId);
      }
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

  app.get("/api/health", (req, res) => {
    const userId = getUserFromRequest(req, noPassword);
    if (userId) {
      res.json({
        status: "ok",
        opencode: bridge.isConnected(),
        providers: circuitBreaker.getStatus(),
        version: process.env.npm_package_version || "0.1.0",
      });
    } else {
      res.json({ status: "ok" });
    }
  });

  app.post("/api/rpc", async (req, res) => {
    try {
      const userId = getUserFromRequest(req, noPassword);
      const { method, params } = req.body as {
        method: string;
        params?: unknown;
      };

      if (req.headers.accept === "text/event-stream") {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders();

        const sessionId = (params as Record<string, string>)?.sessionId;

        if (sessionId && userId) {
          const owner = sessionOwnership.get(sessionId);
          if (owner && owner !== userId) {
            res.write(`data: ${JSON.stringify({ type: "error", data: { message: "Not your session" } })}\n\n`);
            res.end();
            return;
          }
        }

        const result = await bridge.rpcStream(
          method,
          params,
          (delta: unknown) => {
            res.write(`data: ${JSON.stringify({ type: "delta", data: delta })}\n\n`);
            if (userId) {
              broadcastToUser(userId, {
                type: "message.delta",
                data: delta,
                sessionId,
              });
            }
          },
        );

        res.write(`data: ${JSON.stringify({ type: "complete", data: result })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        const result = await bridge.rpc(method, params);

        if (method === "session.create" && result && userId) {
          const sessionId = (result as Record<string, string>).id;
          if (sessionId) sessionOwnership.set(sessionId, userId);
        }

        if (method === "session.list" && userId) {
          const sessions = result as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(sessions)) {
            const filtered = sessions.filter((s) => {
              const sid = s.id as string;
              const owner = sessionOwnership.get(sid);
              return !owner || owner === userId;
            });
            res.json({ jsonrpc: "2.0", id: 1, result: filtered });
            return;
          }
        }

        res.json({ jsonrpc: "2.0", id: 1, result });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ type: "error", data: { message } })}\n\n`);
        res.end();
      } else {
        res.status(500).json({
          jsonrpc: "2.0",
          id: 1,
          error: {
            code: -32603,
            message,
          },
        });
      }
    }
  });

  app.get("/api/models", async (_req, res) => {
    try {
      const [zenModels, freeModels] = await Promise.allSettled([
        Promise.resolve(getZenModels()),
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
      const userId = getUserFromRequest(req, noPassword);
      const { requestId, approved } = req.body as {
        requestId: string;
        approved: boolean;
      };

      const owner = requestOwnership.get(requestId);
      if (owner && userId && owner !== userId) {
        res.status(403).json({ error: "Not your request" });
        return;
      }

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
    bridge.connectWebSocket((notification) => {
      if (notification.type === "tool.request" && notification.sessionId) {
        const reqData = notification.data as Record<string, string> | undefined;
        if (reqData?.id) {
          const owner = sessionOwnership.get(notification.sessionId);
          if (owner) requestOwnership.set(reqData.id, owner);
        }
      }

      const sid = notification.sessionId;
      if (sid) {
        const owner = sessionOwnership.get(sid);
        if (owner) {
          broadcastToUser(owner, notification);
          return;
        }
      }
      broadcastToAll(notification);
    });
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
