import path from "node:path";
import { defineConfig } from "vitest/config";

// Pure-function unit tests only (src/lib/scoring) — no DOM, no DB, no Apify.
// Kept separate from Playwright's e2e suite (test:e2e), which drives a real browser.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
