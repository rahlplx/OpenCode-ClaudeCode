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
