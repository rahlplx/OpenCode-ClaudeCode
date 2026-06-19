# Key patterns

- Express `json()` middleware runs globally — handlers receive parsed `req.body`, never read the raw stream manually
- Provider proxy must check `req.body` first (Express pre-parsed) before falling back to `readRequestBody()`
- `WebSocket` must be imported from `ws` package (not global) for Node <22 compatibility
- `navigator.clipboard` requires optional chaining (unavailable in non-HTTPS contexts)
- No `process.cwd()` in browser code — Vue composables run client-side only
- Dynamic `import()` in server routes breaks after tsup bundling — use static imports
- Check `res.headersSent` before setting status codes in streaming error handlers
