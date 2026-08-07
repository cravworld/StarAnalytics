import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { mintSessionCookie } from "./auth/mintSession";

/**
 * Phase 3 DoD (automatable parts): paste a small agency post-URL batch through
 * the real upload UI, run it through the real "Analyse All Posts" flow
 * (server action -> after() batch job -> status polling), and confirm real
 * scored data renders across all three tabs — including the evidence
 * drill-down and the two honestly-marked "not evaluated" flag types.
 *
 * Run against DATA_MODE_APIFY=mock (the mock provider now returns seed-shaped
 * likes/comments per URL — see mock-public-content.ts) so this never calls a
 * real, metered Apify actor.
 */

// Anchored to the exact shape generated below, so a real agency whose name merely
// contains "E2E" can never be caught by the cleanup.
const E2E_AGENCY_NAME_RE = /^E2E Agency \d+$/;

test.describe("Phase 3 — agency report upload, scoring, and evidence drill-down", () => {
  // Shortcodes this run planted, so cleanup deletes only its own rows and never a
  // concurrent run's.
  let stamp = 0;

  test.beforeEach(async ({ context }) => {
    await context.addCookies([await mintSessionCookie()]);
  });

  // playwright.config.ts loads the real production DATABASE_URL — only DATA_MODE_* is
  // mocked, never the database. Without this, every local `npm run test:e2e` left three
  // more agency rows in prod, and they surfaced in the app's own Agency Report as if they
  // were real clients. Three of them were still sitting there on 2026-08-07. Same unclean-
  // test pattern already fixed in phase2-campaigns.spec.ts; scripts/purge-e2e-agencies.mjs
  // clears rows created before this fix.
  test.afterAll(async () => {
    const prisma = new PrismaClient();
    try {
      const agencies = await prisma.agency.findMany({ select: { id: true, name: true } });
      const ids = agencies.filter((a) => E2E_AGENCY_NAME_RE.test(a.name)).map((a) => a.id);
      if (ids.length === 0) return;
      // Children first — Agency's FKs are not ON DELETE CASCADE, so the delete below
      // would otherwise fail rather than orphan anything. AgencyPostScore also points at
      // Post, so scores have to clear before posts.
      await prisma.agencyPostScore.deleteMany({ where: { agencyId: { in: ids } } });
      await prisma.post.deleteMany({ where: { agencyId: { in: ids } } });
      // Belt-and-braces for posts this run created that never got linked to an agency
      // (a URL whose shortcode didn't resolve). Guarded on stamp: if the test failed
      // before assigning it, `e2e0` would be a prefix broad enough to match rows this
      // run never created.
      if (stamp > 0) {
        await prisma.post.deleteMany({ where: { igShortcode: { startsWith: `e2e${stamp}` } } });
      }
      await prisma.agency.deleteMany({ where: { id: { in: ids } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  test("upload links, run analysis, and see real scored results with evidence", async ({ page }) => {
    await page.goto("/campaigns/agency");
    await expect(page.getByText("Upload Agency Post Links")).toBeVisible();

    stamp = Date.now();
    // A mix of clean-shaped and flagged-shaped URLs — the mock provider cycles
    // seed.ts's POSTS engagement pattern by index, so different shortcodes get
    // different clean-vs-flagged like:comment ratios.
    const rows = Array.from({ length: 12 }, (_, i) => `E2E Agency ${i % 3}, https://instagram.com/p/e2e${stamp}${i}`).join(
      "\n",
    );

    await page.getByPlaceholder(/Agency Name, Post URL/).fill(rows);
    // Parsing happens on blur — Tab away to trigger it reliably.
    await page.keyboard.press("Tab");
    await expect(page.getByText(/Added 12 link/)).toBeVisible();

    await page.getByRole("button", { name: /Analyse All Posts \(12\)/ }).click();
    await expect(page.getByText(/Scraping and scoring posts/)).toBeVisible();

    // The batch job runs in after() — poll-driven, can take a few seconds.
    await expect(page.getByText("Agency Scorecard")).toBeVisible({ timeout: 30_000 });

    // --- Scorecard tab ---
    await expect(page.getByText(/3 agencies · 12 posts analysed/)).toBeVisible();
    await expect(page.getByText("Agency Leaderboard — Overall Score")).toBeVisible();
    await expect(page.getByText(/no efficiency signal independent of performance/)).toBeVisible();

    // --- Authenticity Audit tab ---
    await page.getByRole("button", { name: "Authenticity Audit" }).click();
    await expect(page.getByText("Not Evaluated This Phase")).toBeVisible();
    await expect(page.getByText("Low save-to-like ratio")).toBeVisible();
    await expect(page.getByText(/saves unavailable for third-party posts/)).toBeVisible();
    await expect(page.getByText("Generic comment patterns")).toBeVisible();
    await expect(page.getByText(/requires commenter-profile data outside current scrape scope/)).toBeVisible();

    // --- All Posts tab ---
    await page.getByRole("button", { name: "All Posts" }).click();
    await expect(page.getByText(/Showing \d+ of 12 posts/)).toBeVisible();
    // Not-evaluated chips appear on every row, not just once.
    await expect(page.getByText("Saves: N/A").first()).toBeVisible();
    await expect(page.getByText("Comments: N/A").first()).toBeVisible();

    // Evidence drill-down: 12 posts cycling the mock's seed-derived pattern by
    // index include at least one of seed.ts's flagged-shaped ratios (indices
    // 5-7), so a real flag chip must exist here — not conditionally skipped.
    const flagChip = page.locator("button.flag-chip").first();
    await expect(flagChip).toBeVisible();
    await flagChip.click();
    await expect(page.getByText("Evidence")).toBeVisible();
    await expect(page.getByText(/like to comment ratio/i)).toBeVisible();
    await page.getByRole("button", { name: "✕ Close" }).click();
  });
});
