import { describe, it, expect, beforeEach } from "vitest";
import {
  createSession,
  getUserIdFromToken,
  parseCookies,
  getUserFromRequest,
  generatePassword,
  COOKIE_NAME,
} from "../src/server/auth.js";
import type { IncomingMessage } from "http";

describe("auth", () => {
  describe("createSession", () => {
    it("creates a session with default userId", () => {
      const token = createSession();
      expect(token).toHaveLength(64);
      expect(getUserIdFromToken(token)).toBe("default");
    });

    it("creates a session with specific userId", () => {
      const token = createSession("user-123");
      expect(getUserIdFromToken(token)).toBe("user-123");
    });

    it("generates unique tokens", () => {
      const t1 = createSession();
      const t2 = createSession();
      expect(t1).not.toBe(t2);
    });
  });

  describe("getUserIdFromToken", () => {
    it("returns null for unknown token", () => {
      expect(getUserIdFromToken("nonexistent")).toBeNull();
    });

    it("returns userId for valid token", () => {
      const token = createSession("alice");
      expect(getUserIdFromToken(token)).toBe("alice");
    });
  });

  describe("parseCookies", () => {
    it("parses single cookie", () => {
      expect(parseCookies("foo=bar")).toEqual({ foo: "bar" });
    });

    it("parses multiple cookies", () => {
      expect(parseCookies("a=1; b=2; c=3")).toEqual({ a: "1", b: "2", c: "3" });
    });

    it("handles empty string", () => {
      expect(parseCookies("")).toEqual({});
    });

    it("handles cookie values with equals signs", () => {
      expect(parseCookies("token=abc=def=ghi")).toEqual({ token: "abc=def=ghi" });
    });
  });

  describe("getUserFromRequest", () => {
    it("returns 'default' when noPassword is true", () => {
      const req = { headers: {} } as IncomingMessage;
      expect(getUserFromRequest(req, true)).toBe("default");
    });

    it("returns null when no cookie present and noPassword is false", () => {
      const req = { headers: {} } as IncomingMessage;
      expect(getUserFromRequest(req, false)).toBeNull();
    });

    it("returns userId from valid session cookie", () => {
      const token = createSession("bob");
      const req = {
        headers: { cookie: `${COOKIE_NAME}=${token}` },
      } as unknown as IncomingMessage;
      expect(getUserFromRequest(req, false)).toBe("bob");
    });

    it("returns null for invalid session cookie", () => {
      const req = {
        headers: { cookie: `${COOKIE_NAME}=invalid-token` },
      } as unknown as IncomingMessage;
      expect(getUserFromRequest(req, false)).toBeNull();
    });
  });

  describe("generatePassword", () => {
    it("generates 32-char hex password", () => {
      const pwd = generatePassword();
      expect(pwd).toHaveLength(32);
      expect(pwd).toMatch(/^[0-9a-f]+$/);
    });
  });
});
