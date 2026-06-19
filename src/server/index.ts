import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { OpenCodeBridge } from "./bridge.js";
import { handleProviderProxy, circuitBreaker } from "./proxy.js";
import { handleLogin, requireAuth, generatePassword, getUserFromRequest, parseCookies, getUserIdFromToken, COOKIE_NAME } from "./auth.js";
import { handleKannaConnection, providerConfigManager } from "./kanna-adapter.js";
import { getZenModels } from "../providers/zen.js";
import { fetchFreeModels } from "../providers/openrouter.js";
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

  // Kanna WebSocket at /ws
  const kannaWss = new WebSocketServer({ noServer: true });
  // Legacy WebSocket at /api/ws
  const legacyWss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = req.url || "";
    if (url === "/ws" || url.startsWith("/ws?")) {
      kannaWss.handleUpgrade(req, socket, head, (ws) => {
        kannaWss.emit("connection", ws, req);
      });
    } else if (url === "/api/ws" || url.startsWith("/api/ws?")) {
      legacyWss.handleUpgrade(req, socket, head, (ws) => {
        legacyWss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    if (!noPassword) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:; font-src 'self'",
    );
    next();
  });

  // CORS
  const allowedOrigins = new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]);

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  // Rate limiting (per-IP, sliding window)
  const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
  const RATE_LIMIT_WINDOW_MS = 60_000;
  const RATE_LIMIT_MAX = 100;

  app.use("/api", (req, res, next) => {
    if (req.path === "/health") {
      next();
      return;
    }
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    let entry = rateLimitMap.get(ip);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
      rateLimitMap.set(ip, entry);
    }
    entry.count++;
    if (entry.count > RATE_LIMIT_MAX) {
      res.status(429).json({ error: "Rate limit exceeded" });
      return;
    }
    next();
  });

  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap) {
      if (now > entry.resetAt) rateLimitMap.delete(ip);
    }
  }, RATE_LIMIT_WINDOW_MS);

  const OWNERSHIP_MAX_AGE = 24 * 60 * 60 * 1000;
  const ownershipTimestamps = new Map<string, number>();
  setInterval(() => {
    const now = Date.now();
    for (const [id, ts] of ownershipTimestamps) {
      if (now - ts > OWNERSHIP_MAX_AGE) {
        ownershipTimestamps.delete(id);
        sessionOwnership.delete(id);
        requestOwnership.delete(id);
      }
    }
  }, 60 * 60 * 1000);

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

  // Kanna WebSocket handler
  kannaWss.on("connection", (ws, req) => {
    handleKannaConnection(ws, req, noPassword);
  });

  // Legacy WebSocket handler
  legacyWss.on("connection", (ws, req) => {
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

  app.use(express.json({ limit: "32kb" }));

  // Kanna auth routes (without /api prefix)
  app.get("/auth/status", (req, res) => {
    if (noPassword) {
      res.json({ enabled: false, authenticated: true });
      return;
    }
    const cookies = parseCookies(req.headers.cookie || "");
    const token = cookies[COOKIE_NAME];
    const userId = getUserIdFromToken(token);
    res.json({ enabled: true, authenticated: Boolean(userId) });
  });

  app.post("/auth/login", (req, res) => {
    handleLogin(req, res, password);
  });

  app.post("/auth/logout", (_req, res) => {
    res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    res.json({ success: true });
  });

  // Health endpoint (Kanna expects /health without /api prefix too)
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Legacy API auth
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
          if (sessionId) {
            sessionOwnership.set(sessionId, userId);
            ownershipTimestamps.set(sessionId, Date.now());
          }
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
      const internalMessage = err instanceof Error ? err.message : String(err);
      console.error("RPC error:", internalMessage);
      const safeMessage = "Internal server error";
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ type: "error", data: { message: safeMessage } })}\n\n`);
        res.end();
      } else {
        res.status(500).json({
          jsonrpc: "2.0",
          id: 1,
          error: {
            code: -32603,
            message: safeMessage,
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

  function buildProxyConfig() {
    const providers: Record<string, ReturnType<typeof providerConfigManager.getProxyEntry>> = {};
    for (const p of (["zen", "openrouter", "custom"] as ProviderType[])) {
      providers[p] = providerConfigManager.getProxyEntry(p);
    }
    return {
      providers: Object.fromEntries(
        Object.entries(providers).filter(([, v]) => v !== null),
      ) as Record<ProviderType, NonNullable<ReturnType<typeof providerConfigManager.getProxyEntry>>>,
    };
  }

  app.post("/api/proxy/:provider/v1/responses", (req, res) => {
    const provider = req.params.provider as ProviderType;
    const proxyConfig = buildProxyConfig();
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
    app.get("*path", (_req, res) => {
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
