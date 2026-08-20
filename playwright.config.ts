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
    // Was `!process.env.CI`, which quietly voided the DATA_MODE_* pin below. Locally that
    // reuses whatever is already on :3000 — normally a dev server started from .env.local,
    // where DATA_MODE_APIFY is "live" — and env here only applies to a server Playwright
    // starts itself. So the promise in the comment below was decorative in exactly the case
    // it was written for, and phase3-agency-verify would have run its "Analyse All Posts"
    // flow against the real, metered Apify actor.
    //
    // false instead: if something is already on :3000, Playwright fails loudly ("already
    // used…") rather than silently spending money. A failure you fix by killing your dev
    // server strictly beats a metered call you only discover on the invoice. A suite that
    // pins its providers has to own its server, or the pin isn't real.
    reuseExistingServer: false,
    timeout: 120_000,
    // Phase 0's "renders seeded mock data" suite (and Compare Pages / Agency Report,
    // which call the provider directly on every render/click) must run against the
    // mock provider — pinning here stops the e2e run from making real, metered Apify
    // calls regardless of what DATA_MODE_APIFY is set to in .env.local for normal dev.
    env: {
      DATA_MODE_APIFY: "mock",
      DATA_MODE_INSTAGRAM: "mock",
      DATA_MODE_SENTIMENT: "mock",
      DATA_MODE_NOTIFIER: "mock",
    },
  },
});
