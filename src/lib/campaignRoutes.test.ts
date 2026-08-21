import { describe, it, expect } from "vitest";
import { CAMPAIGN_SUBROUTES, CAMPAIGN_NAV_SUBROUTES, isCampaignDetailRoute } from "./campaignRoutes";

// This function is the reason three components used to disagree about what a campaign page
// is. Each case below corresponds to a symptom that actually shipped.
describe("isCampaignDetailRoute", () => {
  it("is true only for an actual campaign id", () => {
    expect(isCampaignDetailRoute("/campaigns/2f9d1c3a-4b7e-11f0-9cd6-0242ac120002")).toBe(true);
  });

  it("is false for the campaigns index", () => {
    expect(isCampaignDetailRoute("/campaigns")).toBe(false);
  });

  // The shipped bug: a page missing from a local copy of the list rendered "Campaigns ›
  // Own Campaigns › Campaign Detail" and highlighted the wrong tab.
  it("is false for every known subroute", () => {
    for (const route of CAMPAIGN_SUBROUTES) {
      expect(isCampaignDetailRoute(route.href), route.href).toBe(false);
    }
  });

  it("keeps a nested route classified with its parent subroute", () => {
    expect(isCampaignDetailRoute("/campaigns/agency/some-run-id")).toBe(false);
  });

  // Post Tracker's detail route is /campaigns/tracker/[campaignId], so its path genuinely
  // ends in a campaign uuid — the one shape most likely to be misread as /campaigns/[id]
  // and light up the wrong nav tab. Pinned explicitly rather than relying on the loop above,
  // which only checks the bare subroute hrefs.
  it("classifies the post tracker's campaign detail route with the tracker, not as a campaign", () => {
    expect(isCampaignDetailRoute("/campaigns/tracker/2f9d1c3a-4b7e-11f0-9cd6-0242ac120002")).toBe(false);
  });

  it("ignores unrelated paths that merely share a prefix", () => {
    expect(isCampaignDetailRoute("/campaigns-archive")).toBe(false);
    expect(isCampaignDetailRoute("/compare")).toBe(false);
  });
});

describe("CAMPAIGN_SUBROUTES", () => {
  it("has no duplicate hrefs", () => {
    const hrefs = CAMPAIGN_SUBROUTES.map((r) => r.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  // /campaigns/new is a create form reached from a button, not a nav destination — but it
  // must still be in the full list, or it gets misread as a campaign id.
  it("excludes hidden routes from nav but keeps them in the detail check", () => {
    expect(CAMPAIGN_NAV_SUBROUTES.some((r) => r.href === "/campaigns/new")).toBe(false);
    expect(isCampaignDetailRoute("/campaigns/new")).toBe(false);
  });
});
