# Meta-learnings — failure-driven accuracy

Patterns extracted from repeated failures during this development cycle.
Each entry is a failure that happened, what it cost, and how to avoid it.

---

## Smoke test / verification loop

### Failure: testing against stale server
**What happened:** Ran smoke test after fixing `project.create`, got "Command not yet implemented".
**Cost:** One wasted run + confusion.
**Fix:** Always kill + restart the server after code changes: `fuser -k 4080/tcp && node dist-cli/index.js serve ...`
**Rule:** Never run a verification loop without restarting the process under test.

### Failure: WS subscribe envelope used string topic
**What happened:** Sent `{ type: "subscribe", topic: "local-projects" }` — silently dropped by `isClientEnvelope()`.
**Cost:** 8-second timeout per run × 2 runs.
**Fix:** Topic must be an object: `topic: { type: "local-projects" }`. `id` field also required.
**Rule:** Read `isClientEnvelope()` and the `SubscriptionTopic` union type before writing any WS test code.

### Failure: CSS selector for Radix component assumed non-existent attribute
**What happened:** Used `[data-radix-select-trigger]` — attribute doesn't exist in this Radix version.
**Cost:** One failed step, one debug cycle.
**Fix:** Radix `SelectTrigger` renders as `button[role="combobox"]`. Verify attributes in running DOM.
**Rule:** Never assume Radix/shadcn attribute names from docs — inspect the actual element.

### Failure: multiple comboboxes, wrong one selected
**What happened:** `button[role="combobox"]:first` returned "Last Used" (default provider selector), not "Zen" (LLM provider).
**Cost:** One failed assertion.
**Fix:** Use content-specific probe — check `input[placeholder*="Zen API key"]` to confirm the right provider is active.
**Rule:** When a page has multiple instances of a component, anchor selectors to nearby unique content.

### Failure: `pnpm smoke --json` output unpipeable
**What happened:** pnpm prepends `> opencode-claudecode@0.1.0 smoke` to stdout, breaking `| jq`.
**Cost:** Parse error, required reading report.json directly.
**Fix:** Added `smoke:json` script; or use `node scripts/smoke-test.ts --json` directly.
**Rule:** Scripts that produce machine-readable output need a way to suppress the package manager banner.

### Failure: settings page navigated to wrong route
**What happened:** Navigated to `/settings/general` — provider UI is at `/settings/providers`.
**Cost:** 8-second timeout per step.
**Fix:** Settings route map: `/settings/providers` = LLM UI, `/settings/general` = app preferences, `/settings/changelog` = releases.
**Rule:** Always verify route → component mapping from the actual React Router config before writing navigation in tests.

---

## Code correctness failures

### Failure: `path.split("/").pop()` on cross-platform paths
**What happened:** Used in `project.create` and `project.open` for directory name extraction.
**Cost:** Silent wrong title on Windows (whole path used as project name).
**Fix:** `import { basename } from "path"` — handles `\` and `/` automatically.
**Rule:** Any path string manipulation must go through `node:path`. Never string-split paths.

### Failure: missing `localPath` type check before `resolveTilde()`
**What happened:** Malformed WS command without `localPath` would cause `TypeError: Cannot read property 'startsWith' of undefined`, crashing the Node process.
**Cost:** Would have been a production server crash.
**Fix:** `if (typeof cmd.localPath !== "string") { sendEnvelope(...error...); break; }`
**Rule:** WS command payloads are untyped at runtime — validate every field before use.

### Failure: `handleChatRequest` called without `void`
**What happened:** Async function called as fire-and-forget without `void` — linters would flag, intent unclear.
**Cost:** Code smell, potential ESLint error if `@typescript-eslint/no-floating-promises` is enabled.
**Fix:** `void handleChatRequest(...)` makes intent explicit. Errors handled internally in the function.
**Rule:** All fire-and-forget async calls must be prefixed with `void`.

### Failure: redundant conditional branch
**What happened:** `validateLlmProvider` for `zen` had two branches both returning `{ ok: true, error: null }`.
**Cost:** Confusion for future readers.
**Fix:** Collapse to single return.
**Rule:** Any `if (cond) { return X; } return X;` pattern is dead code — collapse immediately.

---

## CSP / security failures

### Failure: CSP blocked GitHub API fetch silently
**What happened:** Changelog section fetched `https://api.github.com` but `connect-src` only allowed `'self' ws: wss:`. Console showed `net::ERR_BLOCKED_BY_CSP`.
**Cost:** Changelog feature non-functional in all environments.
**Fix:** Add `https://api.github.com` to `connect-src` at `src/server/index.ts:61`.
**Rule:** Every new external fetch needs a corresponding CSP `connect-src` entry. Check this during PR review.

### Failure: changelog URL hardcoded to original repo
**What happened:** `GITHUB_RELEASES_URL` pointed to `jakemor/kanna` — showing Kanna's releases, not ours.
**Cost:** Wrong changelog content in production.
**Fix:** Update to `rahlplx/OpenCode-ClaudeCode`.
**Rule:** When adopting verbatim code with hardcoded repo references, search for them immediately: `grep -r "jakemor/kanna"`.

---

## Env / config drift

### Failure: env vars used but undocumented
**What happened:** `ZEN_API_KEY` and `ZEN_BASE_URL` were added to `src/providers/zen.ts` but not in `.env.example`.
**Cost:** Operators setting up the app couldn't know about these vars.
**Fix:** Added to `.env.example` with descriptions.
**Rule:** Every `process.env.FOO` reference must have a corresponding `.env.example` entry. Harness check 14 catches this.

---

## AI review workflow

### Pattern: Gemini Code Assist catches correctness bugs
Gemini flagged the `localPath` crash vulnerability and `path.basename` issue. Both were real bugs worth fixing.
**Rule:** Don't ignore bot review comments just because they come from a bot. Read each one and explicitly decide to fix or dismiss.

### Pattern: CodeRabbit skips draft PRs
CodeRabbit won't review until the PR is marked ready.
**Rule:** Either keep PRs as draft intentionally (CI/review not needed yet) OR mark ready immediately after pushing.

### Pattern: CI failure ≠ code bug in this environment
Every CI run fails with `runner_id: 0` in 2–4 seconds. This is an environment limitation (no GitHub Actions runners).
**Rule:** Don't investigate CI failures without first checking if they complete suspiciously fast (< 10s). Fast completion = no runner = environment issue, not code issue.

---

## Iteration velocity

### What accelerated progress
- Smoke test as a fast feedback loop (3-second runs, clear error messages)
- Running checks in parallel (typecheck + tests + lint simultaneously)
- Reading actual TypeScript types (`SubscriptionTopic`, `isClientEnvelope`) before guessing formats

### What slowed progress
- Not restarting server between code changes (caught us once)
- Assuming Radix attribute names without inspecting the DOM
- Grepping for string patterns that don't exist (wasted queries)

### The "fail faster" principle
Each smoke test run found 1–3 bugs and took < 5 seconds. 4 runs from 3/9 → 9/9.
The cost of a wrong assumption is one 5-second run. The cost of not running is shipping the bug.
**Rule:** Run the smoke test after every fix, not after all fixes.
