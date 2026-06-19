# Key patterns

- Express `json()` middleware runs globally — handlers receive parsed `req.body`, never read the raw stream manually
- Provider proxy must check `req.body` first (Express pre-parsed) before falling back to `readRequestBody()`
- `WebSocket` must be imported from `ws` package (not global) for Node <22 compatibility
- `navigator.clipboard` requires optional chaining (unavailable in non-HTTPS contexts)
- No `process.cwd()` in browser code — React components run client-side only
- Zustand stores use `getState()` for cross-store reads (e.g., chat store reads sessions store)
- Dynamic `import()` in server routes breaks after tsup bundling — use static imports
- Check `res.headersSent` before setting status codes in streaming error handlers
- Express 5 + path-to-regexp v8: wildcard routes must use named params — `app.get("*path", ...)` not `app.get("*", ...)` (bare `*` throws `PathError: Missing parameter name`)
- pnpm blocks esbuild postinstall by default — add `"pnpm": { "onlyBuiltDependencies": ["esbuild"] }` to `package.json` so native binaries download on `pnpm install`
- Body-parser error middleware: catch **all** errors from `express.json()`, not just `SyntaxError` — use `error.status || error.statusCode || 400` to preserve HTTP status (413 Payload Too Large, etc.)
- API/auth prefix guards: use `=== "/api"` or `startsWith("/api/")` — bare `startsWith("/api")` has false positives on `/api-docs`, `/author`, etc.
- Vite chunk splitting: use `rollupOptions.output.manualChunks` to split large deps (xterm, lucide, vendor) and raise `chunkSizeWarningLimit` to 1000
- Managed Gitea environments may block `git push --tags` (403) and have no CI runners — create GitHub releases via API instead of `git push origin <tag>`
