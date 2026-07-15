import { test, expect } from "@playwright/test";
import { mintSessionCookie } from "./auth/mintSession";

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

test.describe("Phase 2 — campaign CRUD and generic detail view", () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([await mintSessionCookie()]);
  });

  test("create a campaign, see it in Own Campaigns, open its detail view", async ({ page }) => {
    const name = `E2E Campaign ${Date.now()}`;

    await page.goto("/campaigns/new");
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Hashtags (comma-separated)").fill("e2etestcampaign");
    await page.getByRole("button", { name: "Create Campaign" }).click();

    // Redirects to /campaigns/[id] on success.
    await expect(page).toHaveURL(/\/campaigns\/[^/]+$/);
    await expect(page.getByText("#e2etestcampaign")).toBeVisible();

    // Honest pending states, not fake numbers or a blank card.
    await expect(page.getByText("Sentiment analysis pending")).toBeVisible();
    await expect(page.getByText("Keyword extraction pending")).toBeVisible();
    await expect(page.getByText(/Pending — No location signal/)).toBeVisible();

    // No posts scraped yet for a brand-new campaign — the stream says so honestly.
    await expect(page.getByText("No posts scraped for this campaign yet.")).toBeVisible();

    // Tab bar stays generic (not special-cased to one campaign's slug).
    await expect(page.locator(".itab.active")).toHaveText("Own Campaigns");

    await page.goto("/campaigns");
    await expect(page.getByText(name)).toBeVisible();
  });

  test("hashtag search page renders with a working Track form", async ({ page }) => {
    await page.goto("/campaigns/hashtag");
    await expect(page.getByPlaceholder("Search any hashtag or keyword…")).toBeVisible();
    await expect(page.getByRole("button", { name: "Track Hashtag" })).toBeVisible();
  });
});
