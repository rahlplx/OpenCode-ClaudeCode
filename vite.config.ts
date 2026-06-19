import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

export default defineConfig({
  test: {
    exclude: [
      "node_modules/**",
      "dist/**",
      "dist-cli/**",
      "src/client/**/*.test.ts",
      "src/client/**/*.test.tsx",
      "src/shared/**/*.test.ts",
      "src/shared/**/*.test.tsx",
    ],
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/ws": {
        target: "ws://localhost:4080",
        ws: true,
      },
      "/api": {
        target: "http://localhost:4080",
        changeOrigin: true,
      },
      "/health": {
        target: "http://localhost:4080",
      },
      "/auth": {
        target: "http://localhost:4080",
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          xterm: ["@xterm/xterm", "@xterm/addon-fit", "@xterm/addon-serialize", "@xterm/addon-web-links"],
          vendor: ["react", "react-dom", "react-router-dom", "zustand"],
          markdown: ["react-markdown", "remark-gfm"],
          icons: ["lucide-react"],
          diff: ["@pierre/diffs"],
          list: ["@legendapp/list"],
        },
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || "0.1.0"),
  },
});
