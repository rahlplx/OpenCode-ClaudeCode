Run `vibe-stack harness` to validate production readiness. Execute all 16 harness checks against the codebase. Report pass/fail for each check.

Check 16: Android build — run `pnpm build:android` (requires `cap sync android` to succeed). Catches Gradle config regressions, Capacitor sync failures, and missing assets.

$ARGUMENTS
