import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
const api = `http://127.0.0.1:${process.env.PUBLIK_API_PORT ?? "8787"}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    global: "globalThis",
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      buffer: "buffer",
      process: "process/browser",
    },
  },
  optimizeDeps: {
    include: ["buffer", "process"],
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/api": api,
      "/skills": api,
      "/.well-known": api,
    },
  },
});
