#!/usr/bin/env tsx
/**
 * Playwright smoke-test harness for OpenCode-ClaudeCode.
 *
 * Drives a real Chromium instance headlessly, captures every console error,
 * JS exception, failed network request, and WebSocket frame, then emits a
 * structured JSON report that an AI can read and act on.
 *
 * Usage:
 *   pnpm smoke [--url http://localhost:5173] [--password secret] [--json]
 *   pnpm smoke --json 2>/dev/null | jq '.steps[] | select(.passed == false)'
 *
 * Exit 0 = all steps passed. Exit 1 = at least one failure.
 * Screenshots → smoke-results/<step-name>.png
 * Full report → smoke-results/report.json
 *
 * One-time setup:  pnpm playwright:install
 */

import { chromium, type Browser, type Page, type BrowserContext } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

// ── CLI args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function flag(name: string, def = ""): string {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : def;
}
const BASE_URL  = flag("--url", "http://localhost:5173");
const PASSWORD  = flag("--password");
const JSON_MODE = argv.includes("--json");
const OUT_DIR   = "smoke-results";

mkdirSync(OUT_DIR, { recursive: true });

// ── Types ─────────────────────────────────────────────────────────────────────
interface StepResult {
  name: string;
  passed: boolean;
  duration: number;
  errors: string[];
  screenshot?: string;
}

interface ConsoleEntry  { level: string; text: string; url: string; }
interface PageErrEntry  { message: string; stack: string; }
interface RequestEntry  { method: string; url: string; status: number | null; }
interface WsFrame       { dir: "sent" | "recv"; payload: string; ts: number; }

// ── Global collectors ─────────────────────────────────────────────────────────
const consoleLog:   ConsoleEntry[]  = [];
const pageErrors:   PageErrEntry[]  = [];
const failedReqs:   RequestEntry[]  = [];
const wsFrames:     WsFrame[]       = [];

// ── Helpers ───────────────────────────────────────────────────────────────────
async function shot(page: Page, name: string): Promise<string> {
  const slug = name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const path = join(OUT_DIR, `${slug}.png`);
  await page.screenshot({ path, fullPage: true }).catch(() => {});
  return path;
}

async function runStep(
  name: string,
  page: Page,
  fn: () => Promise<void>,
): Promise<StepResult> {
  const t0 = Date.now();
  try {
    await fn();
    const screenshot = await shot(page, name);
    return { name, passed: true, duration: Date.now() - t0, errors: [], screenshot };
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}` : String(err);
    const screenshot = await shot(page, `FAIL-${name}`);
    return { name, passed: false, duration: Date.now() - t0, errors: [msg], screenshot };
  }
}

function attachListeners(page: Page): void {
  page.on("console", msg => {
    consoleLog.push({ level: msg.type(), text: msg.text(), url: page.url() });
  });
  page.on("pageerror", err => {
    pageErrors.push({ message: err.message, stack: err.stack ?? "" });
  });
  page.on("requestfailed", req => {
    failedReqs.push({ method: req.method(), url: req.url(), status: null });
  });
  page.on("response", async resp => {
    if (resp.status() >= 400) {
      failedReqs.push({ method: resp.request().method(), url: resp.url(), status: resp.status() });
    }
  });
  page.on("websocket", ws => {
    ws.on("framesent",     f => wsFrames.push({ dir: "sent", payload: String(f.payload), ts: Date.now() }));
    ws.on("framereceived", f => wsFrames.push({ dir: "recv", payload: String(f.payload), ts: Date.now() }));
  });
}

// ── Steps ─────────────────────────────────────────────────────────────────────

async function stepAuthStatus(page: Page): Promise<StepResult> {
  return runStep("Auth status endpoint", page, async () => {
    const res = await page.request.get(`${BASE_URL}/auth/status`);
    if (!res.ok()) throw new Error(`/auth/status returned HTTP ${res.status()}`);
    const body = await res.json() as Record<string, unknown>;
    if (typeof body.enabled !== "boolean") throw new Error(`Unexpected body: ${JSON.stringify(body)}`);
  });
}

async function stepAppLoads(page: Page): Promise<StepResult> {
  return runStep("App loads", page, async () => {
    await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 20_000 });
    // React root must mount something
    await page.waitForSelector("#root > *", { timeout: 10_000 });
  });
}

async function stepLogin(page: Page, password: string): Promise<StepResult> {
  return runStep("Login", page, async () => {
    if (!password) throw new Error("Auth is enabled but --password was not supplied");
    const res = await page.request.post(`${BASE_URL}/auth/login`, {
      data: { password },
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok()) throw new Error(`Login returned HTTP ${res.status()}`);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("#root > *", { timeout: 10_000 });
  });
}

async function stepNoJsErrors(page: Page): Promise<StepResult> {
  // Snapshot page errors collected so far
  const errs = [...pageErrors];
  return {
    name: "No JS exceptions on load",
    passed: errs.length === 0,
    duration: 0,
    errors: errs.map(e => e.message),
    screenshot: await shot(page, "no-js-errors"),
  };
}

async function stepWebSocket(page: Page): Promise<StepResult> {
  return runStep("WebSocket: connect and snapshot", page, async () => {
    await page.evaluate((wsUrl) => {
      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error("Timed out waiting for WS snapshot/event (8s)"));
        }, 8_000);
        ws.addEventListener("open", () => {
          // Correct Kanna envelope format: topic is an object, id is required
          ws.send(JSON.stringify({
            v: 1,
            type: "subscribe",
            id: "smoke-sub-1",
            topic: { type: "local-projects" },
          }));
        });
        ws.addEventListener("message", (e) => {
          try {
            const msg = JSON.parse(e.data as string) as { type: string };
            if (msg.type === "snapshot" || msg.type === "event") {
              clearTimeout(timer);
              ws.close();
              resolve();
            }
          } catch { /* ignore non-JSON */ }
        });
        ws.addEventListener("error", () => {
          clearTimeout(timer);
          reject(new Error("WebSocket connection error"));
        });
      });
    }, BASE_URL.replace(/^http/, "ws") + "/ws");
  });
}

async function stepSettingsRoute(page: Page): Promise<StepResult> {
  return runStep("Settings page: route renders", page, async () => {
    // /settings/providers is the section with the LLM provider dropdown
    await page.goto(`${BASE_URL}/settings/providers`, { waitUntil: "networkidle", timeout: 10_000 });
    // The Radix SelectTrigger renders the current provider name as visible text
    await page.waitForSelector(
      '[data-radix-select-trigger], input[type="password"]',
      { timeout: 8_000 },
    );
  });
}

async function stepZenProviderVisible(page: Page): Promise<StepResult> {
  return runStep("Settings: Zen provider option visible", page, async () => {
    // When Zen is the selected provider the password input has this specific placeholder
    const input = page.locator('input[placeholder*="Zen API key"]');
    const visible = await input.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!visible) {
      // Also accept any combobox showing Zen text (covers different Radix versions)
      const zenTrigger = page.getByRole("combobox", { name: /zen/i });
      const triggerVisible = await zenTrigger.isVisible({ timeout: 2_000 }).catch(() => false);
      if (!triggerVisible) throw new Error("Neither Zen API key input placeholder nor Zen combobox found — Zen may not be the default provider");
    }
  });
}

async function stepApiKeyInput(page: Page): Promise<StepResult> {
  return runStep("Settings: API key field accepts input", page, async () => {
    const input = page.locator('input[type="password"]').first();
    const visible = await input.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!visible) throw new Error("No password-type API key input found on /settings/providers");
    await input.fill("test-key-smoke");
    const val = await input.inputValue();
    if (!val.includes("test-key")) throw new Error(`Field value mismatch: got "${val}"`);
    await input.fill(""); // clear after test
  });
}

async function stepProjectCreateWs(page: Page): Promise<StepResult> {
  return runStep("project.create command: ack received", page, async () => {
    const ack = await page.evaluate((wsUrl) => {
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error("Timed out waiting for project.create ack (8s)"));
        }, 8_000);
        ws.addEventListener("open", () => {
          ws.send(JSON.stringify({
            v: 1,
            type: "command",
            id: "smoke-create-1",
            command: { type: "project.create", localPath: "/tmp/smoke-test-project", title: "Smoke Test" },
          }));
        });
        ws.addEventListener("message", (e) => {
          try {
            const msg = JSON.parse(e.data as string) as { type: string; id?: string };
            if ((msg.type === "ack" || msg.type === "error") && msg.id === "smoke-create-1") {
              clearTimeout(timer);
              ws.close();
              resolve(msg as Record<string, unknown>);
            }
          } catch { /* ignore */ }
        });
        ws.addEventListener("error", () => {
          clearTimeout(timer);
          reject(new Error("WebSocket error during project.create"));
        });
      });
    }, BASE_URL.replace(/^http/, "ws") + "/ws");

    if ((ack as { type: string }).type === "error") {
      throw new Error(`Server returned error: ${(ack as { message?: string }).message ?? JSON.stringify(ack)}`);
    }
  });
}

async function stepMobileViewport(ctx: BrowserContext): Promise<StepResult> {
  let mobilePage: Page | undefined;
  const t0 = Date.now();
  try {
    mobilePage = await ctx.newPage();
    await mobilePage.setViewportSize({ width: 375, height: 667 });
    await mobilePage.goto(BASE_URL, { waitUntil: "networkidle", timeout: 15_000 });
    await mobilePage.waitForSelector("#root > *", { timeout: 8_000 });

    // Check no horizontal overflow — scrollWidth must equal clientWidth
    const hasOverflow = await mobilePage.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    const screenshot = await shot(mobilePage, "mobile-375");
    if (hasOverflow) {
      return { name: "Mobile viewport: no horizontal overflow", passed: false, duration: Date.now() - t0, errors: ["Horizontal overflow detected at 375px width (content wider than viewport)"], screenshot };
    }
    return { name: "Mobile viewport: no horizontal overflow", passed: true, duration: Date.now() - t0, errors: [], screenshot };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const screenshot = mobilePage ? await shot(mobilePage, "FAIL-mobile") : undefined;
    return { name: "Mobile viewport: no horizontal overflow", passed: false, duration: Date.now() - t0, errors: [msg], screenshot };
  } finally {
    await mobilePage?.close();
  }
}

async function stepNoApiFailures(_page: Page): Promise<StepResult> {
  const apiFailures = failedReqs.filter(r =>
    (r.url.includes("/api/") || r.url.includes("/auth/") || r.url.includes("/ws")) &&
    // Ignore 401 on /auth/status before login
    !(r.url.includes("/auth/status") && r.status === 401)
  );
  return {
    name: "No failed API/WS requests",
    passed: apiFailures.length === 0,
    duration: 0,
    errors: apiFailures.map(r => `${r.method} ${r.url} → ${r.status ?? "connection refused"}`),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  let browser: Browser | undefined;
  const steps: StepResult[] = [];

  try {
    browser = await chromium.launch({ headless: true });
    const ctx: BrowserContext = await browser.newContext({
      // Suppress CORS and cert errors for local dev server
      ignoreHTTPSErrors: true,
    });
    const page: Page = await ctx.newPage();
    attachListeners(page);

    // ── Step 1: Auth status ─────────────────────────────────────────────────
    steps.push(await stepAuthStatus(page));

    // ── Step 2: App loads ───────────────────────────────────────────────────
    steps.push(await stepAppLoads(page));

    // ── Step 3: Login (conditional) ─────────────────────────────────────────
    const authRes = await page.request.get(`${BASE_URL}/auth/status`).then(r => r.json()) as
      { enabled: boolean; authenticated: boolean };
    if (authRes.enabled && !authRes.authenticated) {
      steps.push(await stepLogin(page, PASSWORD));
    }

    // ── Step 4: No JS exceptions on load ────────────────────────────────────
    steps.push(await stepNoJsErrors(page));

    // ── Step 5: WebSocket ───────────────────────────────────────────────────
    steps.push(await stepWebSocket(page));

    // ── Step 6: Settings route ──────────────────────────────────────────────
    steps.push(await stepSettingsRoute(page));

    // ── Step 7: Zen provider visible ────────────────────────────────────────
    steps.push(await stepZenProviderVisible(page));

    // ── Step 8: API key input ────────────────────────────────────────────────
    steps.push(await stepApiKeyInput(page));

    // ── Step 9: project.create command ──────────────────────────────────────
    steps.push(await stepProjectCreateWs(page));

    // ── Step 10: Mobile viewport (375px) ────────────────────────────────────
    steps.push(await stepMobileViewport(ctx));

    // ── Step 11: No API failures ─────────────────────────────────────────────
    steps.push(await stepNoApiFailures(page));

  } finally {
    await browser?.close();
  }

  // ── Build report ──────────────────────────────────────────────────────────
  const passed  = steps.filter(s => s.passed).length;
  const total   = steps.length;
  const allPass = passed === total;

  const consoleErrors = consoleLog.filter(m => m.level === "error");

  const report = {
    timestamp: new Date().toISOString(),
    url: BASE_URL,
    passed: allPass,
    summary: `${passed}/${total} steps passed`,
    steps,
    consoleErrors,
    pageErrors,
    failedRequests: failedReqs,
    wsFrameCount: wsFrames.length,
    wsFrames: wsFrames.slice(0, 50), // first 50 frames for diagnosis
  };

  const reportPath = join(OUT_DIR, "report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  if (JSON_MODE) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const PASS = "\x1b[32m✓\x1b[0m";
    const FAIL = "\x1b[31m✗\x1b[0m";
    console.log(`\nSmoke — ${BASE_URL}  [${new Date().toLocaleTimeString()}]`);
    console.log(`${allPass ? PASS : FAIL} ${report.summary}\n`);
    for (const s of steps) {
      console.log(`  ${s.passed ? PASS : FAIL}  ${s.name}  (${s.duration}ms)`);
      for (const e of s.errors) console.log(`       \x1b[31m${e}\x1b[0m`);
    }
    if (consoleErrors.length) {
      console.log(`\nConsole errors (${consoleErrors.length}):`);
      for (const e of consoleErrors) console.log(`  [${e.url}] ${e.text}`);
    }
    if (pageErrors.length) {
      console.log(`\nPage errors (${pageErrors.length}):`);
      for (const e of pageErrors) console.log(`  ${e.message}`);
    }
    const interestingFails = failedReqs.filter(r => r.url.includes("/api/") || r.url.includes("/auth/") || r.url.includes("/ws"));
    if (interestingFails.length) {
      console.log(`\nFailed API requests (${interestingFails.length}):`);
      for (const r of interestingFails) console.log(`  ${r.method} ${r.url} → ${r.status ?? "refused"}`);
    }
    console.log(`\nReport → ${reportPath}`);
    console.log(`Screenshots → ${OUT_DIR}/\n`);
  }

  process.exit(allPass ? 0 : 1);
}

main().catch(err => {
  console.error("Smoke test crashed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
