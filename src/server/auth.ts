import { randomBytes, timingSafeEqual, createHash } from "crypto";
import type { IncomingMessage, ServerResponse } from "http";

export const COOKIE_NAME = "occ_session_token";
const SESSION_TTL = 24 * 60 * 60 * 1000;

interface SessionEntry {
  token: string;
  userId: string;
  createdAt: number;
}

const activeSessions = new Map<string, SessionEntry>();

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of activeSessions) {
    if (now - session.createdAt > SESSION_TTL) {
      activeSessions.delete(token);
    }
  }
}, 60 * 60 * 1000).unref();

export function generatePassword(): string {
  return randomBytes(16).toString("hex");
}

export function createSession(userId = "default"): string {
  const token = randomBytes(32).toString("hex");
  activeSessions.set(token, { token, userId, createdAt: Date.now() });
  return token;
}

function isValidSession(token: string): boolean {
  const session = activeSessions.get(token);
  if (!session) return false;
  if (Date.now() - session.createdAt > SESSION_TTL) {
    activeSessions.delete(token);
    return false;
  }
  return true;
}

export function getUserIdFromToken(token: string): string | null {
  const session = activeSessions.get(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL) {
    activeSessions.delete(token);
    return null;
  }
  return session.userId;
}

export function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const pair of cookieHeader.split(";")) {
    const [key, ...valueParts] = pair.trim().split("=");
    if (key) cookies[key] = valueParts.join("=");
  }
  return cookies;
}

export function getUserFromRequest(req: IncomingMessage, noPassword: boolean): string | null {
  if (noPassword) return "default";
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  return getUserIdFromToken(token);
}

function constantTimeCompare(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

export function handleLogin(
  req: IncomingMessage,
  res: ServerResponse,
  password: string,
): void {
  const processLogin = (submitted: string) => {
    if (!constantTimeCompare(submitted, password)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid password" }));
      return;
    }

    const userId = createHash("sha256").update(submitted).digest("hex").slice(0, 8);
    const token = createSession(userId);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Set-Cookie": `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}`,
    });
    res.end(JSON.stringify({ success: true }));
  };

  const expressReq = req as IncomingMessage & { body?: { password?: string } };
  if (expressReq.body && typeof expressReq.body === "object") {
    const submitted = expressReq.body.password;
    if (typeof submitted !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid request" }));
      return;
    }
    processLogin(submitted);
    return;
  }

  let body = "";
  let bodySize = 0;
  let limitExceeded = false;
  const MAX_LOGIN_BODY = 4096;
  req.on("data", (chunk: Buffer) => {
    if (limitExceeded) return;
    bodySize += chunk.length;
    if (bodySize > MAX_LOGIN_BODY) {
      limitExceeded = true;
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Request too large" }));
      req.destroy();
      return;
    }
    body += chunk.toString();
  });
  req.on("end", () => {
    if (limitExceeded) return;
    try {
      const { password: submitted } = JSON.parse(body) as {
        password: string;
      };
      if (typeof submitted !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid request" }));
        return;
      }
      processLogin(submitted);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid request" }));
    }
  });
}

export function requireAuth(
  req: IncomingMessage,
  res: ServerResponse,
  noPassword: boolean,
): boolean {
  if (noPassword) return true;

  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[COOKIE_NAME];

  if (token && isValidSession(token)) return true;

  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Authentication required" }));
  return false;
}
