import { describe, it, expect, beforeEach, vi } from "vitest";
import { CircuitBreaker } from "../src/server/circuit-breaker.js";

describe("CircuitBreaker", () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 60_000,
    });
  });

  describe("initial state", () => {
    it("starts closed (healthy) for any provider", () => {
      expect(cb.isAvailable("zen")).toBe(true);
      expect(cb.isAvailable("openrouter")).toBe(true);
      expect(cb.isAvailable("custom")).toBe(true);
    });
  });

  describe("recording failures", () => {
    it("stays closed below threshold", () => {
      cb.recordFailure("zen");
      cb.recordFailure("zen");
      expect(cb.isAvailable("zen")).toBe(true);
    });

    it("opens after reaching failure threshold", () => {
      cb.recordFailure("zen");
      cb.recordFailure("zen");
      cb.recordFailure("zen");
      expect(cb.isAvailable("zen")).toBe(false);
    });

    it("tracks providers independently", () => {
      cb.recordFailure("zen");
      cb.recordFailure("zen");
      cb.recordFailure("zen");
      expect(cb.isAvailable("zen")).toBe(false);
      expect(cb.isAvailable("openrouter")).toBe(true);
    });
  });

  describe("recording success", () => {
    it("resets failure count on success", () => {
      cb.recordFailure("zen");
      cb.recordFailure("zen");
      cb.recordSuccess("zen");
      cb.recordFailure("zen");
      cb.recordFailure("zen");
      expect(cb.isAvailable("zen")).toBe(true);
    });
  });

  describe("reset timeout", () => {
    it("re-closes after reset timeout expires", () => {
      vi.useFakeTimers();
      cb.recordFailure("zen");
      cb.recordFailure("zen");
      cb.recordFailure("zen");
      expect(cb.isAvailable("zen")).toBe(false);

      vi.advanceTimersByTime(60_001);
      expect(cb.isAvailable("zen")).toBe(true);
      vi.useRealTimers();
    });
  });

  describe("getNextProvider", () => {
    it("returns first available provider from chain", () => {
      const chain = ["zen", "openrouter", "custom"] as const;
      expect(cb.getNextProvider([...chain])).toBe("zen");
    });

    it("skips failed providers", () => {
      cb.recordFailure("zen");
      cb.recordFailure("zen");
      cb.recordFailure("zen");
      expect(cb.getNextProvider(["zen", "openrouter", "custom"])).toBe("openrouter");
    });

    it("returns null when all providers are down", () => {
      for (const p of ["zen", "openrouter", "custom"]) {
        cb.recordFailure(p);
        cb.recordFailure(p);
        cb.recordFailure(p);
      }
      expect(cb.getNextProvider(["zen", "openrouter", "custom"])).toBeNull();
    });
  });

  describe("getStatus", () => {
    it("returns status for all tracked providers", () => {
      cb.recordFailure("zen");
      cb.recordFailure("zen");
      cb.recordFailure("zen");
      cb.recordSuccess("openrouter");

      const status = cb.getStatus();
      expect(status.zen.available).toBe(false);
      expect(status.zen.failures).toBe(3);
      expect(status.openrouter.available).toBe(true);
      expect(status.openrouter.failures).toBe(0);
    });
  });
});
