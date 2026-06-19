import { defineConfig } from "tsup";

export default defineConfig([
  {
    // CLI entry — shebang, full sources
    entry: { index: "src/cli/index.ts" },
    outDir: "dist-cli",
    format: ["esm"],
    target: "node18",
    sourcemap: true,
    clean: true,
    banner: { js: "#!/usr/bin/env node" },
    external: ["express", "commander", "ws", "@opencode-ai/sdk"],
  },
  {
    // Electron server entry — no shebang, no banner, keeps CLI output
    entry: { server: "src/server/electron.ts" },
    outDir: "dist-cli",
    format: ["esm"],
    target: "node18",
    sourcemap: false,
    clean: false,
    external: ["express", "ws", "@opencode-ai/sdk"],
  },
]);
