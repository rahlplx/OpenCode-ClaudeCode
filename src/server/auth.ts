import { randomBytes, timingSafeEqual } from "crypto";
import type { IncomingMessage, ServerResponse } from "http";

const COOKIE_NAME = "occ_session_token";
const SESSION_TTL = 24 * 60 * 60 * 1000;

interface SessionEntry {
  token: string;
  createdAt: number;
}

const activeSessions = new Map<string, SessionEntry>();

export function generatePassword(): string {
  return randomBytes(16).toString("hex");
}

export function createSession(): string {
  const token = randomBytes(32).toString("hex");
  activeSessions.set(token, { token, createdAt: Date.now() });
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

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return timingSafeEqual(bufA, bufB);
}

export function handleLogin(
  req: IncomingMessage,
  res: ServerResponse,
  password: string,
): void {
  let body = "";
  req.on("data", (chunk: Buffer) => {
    body += chunk.toString();
  });
  req.on("end", () => {
    try {
      const { password: submitted } = JSON.parse(body) as {
        password: string;
      };

      if (!constantTimeCompare(submitted, password)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid password" }));
        return;
      }

      const token = createSession();
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Set-Cookie": `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}`,
      });
      res.end(JSON.stringify({ success: true }));
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

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const pair of cookieHeader.split(";")) {
    const [key, ...valueParts] = pair.trim().split("=");
    if (key) cookies[key] = valueParts.join("=");
  }
  return cookies;
}
