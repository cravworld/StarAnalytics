import path from "node:path";
import { defineConfig } from "vitest/config";

// Pure-function unit tests only (src/lib/scoring) — no DOM, no DB, no Apify.
// Kept separate from Playwright's e2e suite (test:e2e), which drives a real browser.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // See src/test/serverOnlyStub.ts — without this, importing any server module aborts
      // the suite on an unresolvable package.
      "server-only": path.resolve(__dirname, "./src/test/serverOnlyStub.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/test/loadEnv.ts"],
  },
});
