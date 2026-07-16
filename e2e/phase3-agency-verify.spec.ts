import { test, expect } from "@playwright/test";
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

test.describe("Phase 3 — agency report upload, scoring, and evidence drill-down", () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([await mintSessionCookie()]);
  });

  test("upload links, run analysis, and see real scored results with evidence", async ({ page }) => {
    await page.goto("/campaigns/agency");
    await expect(page.getByText("Upload Agency Post Links")).toBeVisible();

    const stamp = Date.now();
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
