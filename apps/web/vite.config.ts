/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8362",
      "/socket.io": {
        target: "http://localhost:8362",
        ws: true,
      },
      "/media": "http://localhost:8362",
    },
  },
  build: {
    outDir: "dist",
  },
});
