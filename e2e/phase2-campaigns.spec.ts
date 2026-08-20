import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { mintSessionCookie } from "./auth/mintSession";

/**
 * Sign-off screenshots for the two campaign screens that need a campaign to exist before
 * they render anything: the generic detail view and its media kit.
 *
 * They live here rather than in phase0's walk for the same reason the agency ones live in
 * phase3 — phase0 is read-only, and these need a row created first. This test already
 * creates one and cleans it up, so the captures cost nothing extra. 11 replaces the old
 * 11-vijayam-detail.png, a capture of the fixed /campaigns/vijayam route that was replaced
 * by this generic view and no longer exists.
 */
const captureScreen = async (page: Page, name: string) => {
  // Dev-only Next.js badge floats over the sidebar footer; hidden for the capture only,
  // app source untouched. Same treatment as phase0 and phase3.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.screenshot({ path: `e2e/screens/${name}.png`, fullPage: true });
};

/**
 * Phase 2 DoD (automatable parts): create a campaign through the real UI/DB,
 * open its generic detail view, and confirm the honest "pending" states render
 * for sentiment/keywords/geo (Phase 4 work) instead of fake or blank data.
 *
 * Deliberately NOT covered here: triggering a live Apify hashtag scrape (real
 * money, ~15-20s) and watching Supabase Realtime push a new post into the live
 * stream without a refresh — that's the one piece the Phase 2 spec calls out for
 * a human to click through manually rather than automate.
 */

// playwright.config.ts loads the same DATABASE_URL the dev server uses (see its own
// comment on why — avoiding a second secrets file) — DATA_MODE_APIFY=mock means the
// campaign-creation test never makes a real Apify call, but createCampaignAction's
// auto-track still writes a REAL, permanent hashtag_snapshots row via trackHashtag()
// regardless of which provider served the (mocked) data. Confirmed in prod (2026-08-04
// cost audit) that two prior runs of this test had left "E2E Campaign" rows and an
// "e2etestcampaign" hashtag_snapshots row sitting in production, tracked indefinitely.
// Cleanup below removes both so running this suite locally doesn't leave paid-polling
// residue behind.
const createdCampaignIds: string[] = [];
const TEST_HASHTAG = "e2etestcampaign";

test.describe("Phase 2 — campaign CRUD and generic detail view", () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([await mintSessionCookie()]);
  });

  test.afterAll(async () => {
    // createCampaignAction's auto-track runs in a next/server after() callback, deferred
    // past this test's own await chain — give it a moment to land its hashtagSnapshot write
    // before cleanup runs, or that row just gets picked up (harmlessly) by the *next* run's
    // cleanup instead of accumulating forever.
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const prisma = new PrismaClient();
    try {
      if (createdCampaignIds.length > 0) {
        await prisma.post.updateMany({
          where: { campaignId: { in: createdCampaignIds } },
          data: { campaignId: null },
        });
        await prisma.campaign.deleteMany({ where: { id: { in: createdCampaignIds } } });
      }
      await prisma.hashtagSnapshot.deleteMany({ where: { hashtag: TEST_HASHTAG } });
    } finally {
      await prisma.$disconnect();
    }
  });

  test("create a campaign, see it in Own Campaigns, open its detail view", async ({ page }) => {
    const name = `E2E Campaign ${Date.now()}`;

    await page.goto("/campaigns/new");
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Hashtags (comma-separated)").fill(TEST_HASHTAG);
    await page.getByRole("button", { name: "Create Campaign" }).click();

    // Redirects to /campaigns/[id] on success (a uuid — not "new", "hashtag", "agency").
    await expect(page).toHaveURL(/\/campaigns\/(?!new$|hashtag$|agency$)[^/]+$/);
    createdCampaignIds.push(new URL(page.url()).pathname.split("/").pop()!);
    // The detail view now renders the tag in two legitimate places — the hero (.vhero-tag)
    // and the hashtag-breakdown row (.bar-label) — so a bare getByText resolves to two
    // elements and fails Playwright's strict mode. That is an ambiguous locator, not a
    // broken page. Anchor to the hero, which is the one that identifies the campaign, and
    // assert its exact text so a partial match can't stand in for the real tag.
    await expect(page.locator(".vhero-tag")).toHaveText(`#${TEST_HASHTAG}`);

    // Honest pending states, not fake numbers or a blank card.
    await expect(page.getByText("Sentiment analysis pending")).toBeVisible();
    await expect(page.getByText("Keyword extraction pending")).toBeVisible();
    await expect(page.getByText(/Pending — No location signal/)).toBeVisible();

    // No posts scraped yet for a brand-new campaign — the stream says so honestly.
    await expect(page.getByText("No posts scraped for this campaign yet.")).toBeVisible();

    // Tab bar stays generic (not special-cased to one campaign's slug).
    await expect(page.locator(".itab.active")).toHaveText("Own Campaigns");

    // Captured in exactly this state on purpose: a brand-new campaign is the empty/pending
    // case, which is the harder one to get right visually and the one a fixture-backed
    // screenshot could never show.
    await captureScreen(page, "11-campaign-detail");

    // The media kit is a re-skinned screen that had no sign-off capture at all, and it can
    // only render for a campaign that exists — so it piggybacks on the one created above.
    const campaignId = createdCampaignIds[createdCampaignIds.length - 1];
    await page.goto(`/campaigns/${campaignId}/media-kit`);
    // Anchored to the title rather than a bare getByText: the campaign name also appears in
    // the "← Back to <name>" link, so an unscoped match resolves to two elements.
    await expect(page.locator(".mk-title")).toHaveText(name);
    await captureScreen(page, "17-media-kit");

    await page.goto("/campaigns");
    await expect(page.getByText(name)).toBeVisible();
  });

  test("hashtag search page renders with a working Track form", async ({ page }) => {
    await page.goto("/campaigns/hashtag");
    await expect(page.getByPlaceholder("Search any hashtag or keyword…")).toBeVisible();
    await expect(page.getByRole("button", { name: "Track Hashtag" })).toBeVisible();
  });
});
