import { test, expect, type Page } from "@playwright/test";
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

/**
 * Sign-off screenshots for the three post-analysis agency views, keeping the phase0 numbering
 * (08/09/10) so the review set stays contiguous on disk.
 *
 * They used to be captured by phase0-screens.spec.ts, which asserted static seed values the
 * screen stopped rendering once these views were driven by the real scoring pipeline. Capturing
 * them needs an actual analysed batch, and that writes Agency rows — a flow this spec already
 * performs, against the mock provider and with afterAll cleanup. So the captures moved to the
 * one place that flow already runs, rather than a second copy of it being added to the
 * otherwise read-only phase0 walk. Agency names read "E2E Agency 0" rather than a fake client
 * name; that is honest about what the screenshot is, and fine for a layout review.
 */
const captureScreen = async (page: Page, name: string) => {
  // The Next.js dev-tools badge floats over the sidebar footer and hides the "NP" avatar. It
  // exists only in dev and would misrepresent the port in a sign-off shot, so hide it for the
  // capture (same treatment as phase0; app source untouched).
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.screenshot({ path: `e2e/screens/${name}.png`, fullPage: true });
};

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

      // Posts this run is answerable for: those linked to its agencies, plus — belt-and-braces
      // — any carrying this run's stamp that never got linked to one (a URL whose shortcode
      // didn't resolve). Guarded on stamp: if the test failed before assigning it, `e2e0`
      // would be a prefix broad enough to match rows this run never created.
      //
      // Built as a list rather than returning early on `ids.length === 0`, which is how the
      // orphan sweep used to be unreachable in exactly the case it was written for: a run that
      // died after creating posts but before any agency row existed to match.
      const orClauses = [];
      if (ids.length > 0) orClauses.push({ agencyId: { in: ids } });
      if (stamp > 0) orClauses.push({ igShortcode: { startsWith: `e2e${stamp}` } });
      if (orClauses.length === 0) return;

      // Children first — none of these FKs are ON DELETE CASCADE, so a delete in the wrong
      // order fails rather than orphaning anything.
      if (ids.length > 0) {
        await prisma.agencyPostScore.deleteMany({ where: { agencyId: { in: ids } } });
      }

      // Comment sentiment landed after this cleanup was written and hung a second chain off
      // Post: comment_sentiment -> post_comments -> posts. Deleting posts without unwinding it
      // violates post_comments_post_id_fkey, and because that throws midway through the
      // afterAll, the agency deletion below it never runs — silently reinstating the very
      // production pollution this block exists to prevent. Unwind the chain deepest-first.
      const doomedPostIds = (
        await prisma.post.findMany({ where: { OR: orClauses }, select: { id: true } })
      ).map((p) => p.id);

      if (doomedPostIds.length > 0) {
        // Post-level sentiment is a separate table from per-comment sentiment and hangs off
        // Post directly (sentiment_post_id_fkey), so it has to clear too.
        await prisma.sentiment.deleteMany({ where: { postId: { in: doomedPostIds } } });
        await prisma.commentSentiment.deleteMany({
          where: { postComment: { postId: { in: doomedPostIds } } },
        });
        await prisma.postComment.deleteMany({ where: { postId: { in: doomedPostIds } } });
        await prisma.post.deleteMany({ where: { id: { in: doomedPostIds } } });
      }

      if (ids.length > 0) {
        await prisma.agency.deleteMany({ where: { id: { in: ids } } });
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  test("upload links, run analysis, and see real scored results with evidence", async ({ page }) => {
    // This test drives a real scrape-and-score of 12 posts through a background after() job
    // and waits on status polling. The wait below already asks for up to 30s, but Playwright's
    // default *test* budget is also 30s, so that allowance could never actually be spent: the
    // run died on the test timeout with the page still reading "Scraping and scoring posts…",
    // which looks like a broken pipeline and is really just a stopwatch set too short. Give the
    // test as a whole room to outlast its own longest wait.
    test.setTimeout(120_000);

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
    await captureScreen(page, "08-agency-scorecard");

    // --- Authenticity Audit tab ---
    await page.getByRole("button", { name: "Authenticity Audit" }).click();
    await expect(page.getByText("Not Evaluated This Phase")).toBeVisible();
    await expect(page.getByText("Low save-to-like ratio")).toBeVisible();
    await expect(page.getByText(/saves unavailable for third-party posts/)).toBeVisible();

    // "Generic comment patterns" used to be asserted here as a second not-evaluated entry.
    // It graduated: FLAG_REGISTRY reclassified generic_comment_pattern to "implemented" on
    // 2026-08-04 once the per-comment scrape shipped, so it is now a real detector and no
    // longer appears in this panel at all. Asserting its absence — specifically that the
    // superseded reason string is gone — pins the graduation, so if the flag were ever
    // quietly demoted back to not_evaluated this test would say so.
    await expect(page.getByText(/requires commenter-profile data outside current scrape scope/)).toHaveCount(0);
    await captureScreen(page, "09-agency-authenticity");

    // --- All Posts tab ---
    await page.getByRole("button", { name: "All Posts" }).click();
    await expect(page.getByText(/Showing \d+ of 12 posts/)).toBeVisible();
    // Not-evaluated chips appear on every row, not just once.
    await expect(page.getByText("Saves: N/A").first()).toBeVisible();
    // The "Comments: N/A" chip is gone for the same reason as the panel entry above:
    // generic_comment_pattern is an implemented detector now, so comments are evaluated and
    // must NOT be marked N/A. Asserting the absence keeps the two ends consistent — a row
    // claiming "not evaluated" for something the scorer actually checks would be a data-honesty
    // regression, which is precisely what these markers exist to prevent.
    await expect(page.getByText("Comments: N/A")).toHaveCount(0);
    // Captured before the evidence drill-down below, which opens a panel over the table.
    await captureScreen(page, "10-agency-posts");

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
