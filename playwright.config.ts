import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";

// Load the SAME env file the dev server reads. The plan called for a separate
// .env.test.local holding a copy of NEXTAUTH_SECRET, but duplicating the secret
// invites drift: the moment the two copies diverge, the app correctly rejects the
// minted token and the harness fails for a reason that looks nothing like the cause.
// One source of truth removes that failure mode entirely.
//
// The plan's ALLOWED_EMAILS test entry is also omitted: this app enforces the
// allowlist in NextAuth's `signIn` callback (login-time only), not per-request
// middleware, so a minted session never passes through it.
dotenv.config({ path: ".env.local" });

export default defineConfig({
  testDir: "./e2e",
  // Screenshots are the sign-off artifact — a flaky retry that overwrites a good
  // shot with a bad one would defeat the purpose.
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    // Dev server => NODE_ENV !== "production", so mintSession's guard passes.
    command: "npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
