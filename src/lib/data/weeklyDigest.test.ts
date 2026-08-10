import { describe, it, expect } from "vitest";
import { formatWeeklyDigest, type WeeklyDigestCampaignSummary } from "./weeklyDigest";

const GENERATED_AT = new Date("2026-08-10T09:00:00Z");

const CAMPAIGN: WeeklyDigestCampaignSummary = {
  name: "Pluto Movie",
  buzzScore: 81,
  postCount: 361,
  engagementDisplay: "146.7K",
  sentiment: { positivePct: 60, classifiedCount: 361, totalCount: 361 },
  topHashtag: { hashtag: "pluto", postCount: 76, totalEngagement: 17496 },
};

describe("formatWeeklyDigest", () => {
  it("reports no live campaigns honestly rather than an empty section", () => {
    const text = formatWeeklyDigest([], GENERATED_AT);
    expect(text).toContain("No live campaigns this week.");
  });

  it("includes every campaign's name, buzz score, engagement, sentiment, and top hashtag", () => {
    const text = formatWeeklyDigest([CAMPAIGN], GENERATED_AT);
    expect(text).toContain("Pluto Movie");
    expect(text).toContain("Buzz score: 81");
    expect(text).toContain("361 (146.7K engagement)");
    expect(text).toContain("60% positive (361/361 classified)");
    expect(text).toContain("#pluto (76 posts, 17,496 eng)");
  });

  // Sentiment/hashtag are the two fields that can legitimately be absent on a fresh
  // campaign — must render an honest "pending"/"none tracked" line, never fabricate a
  // number or silently omit the campaign, same discipline as SentimentBar's null state.
  it("renders pending sentiment and no-hashtag campaigns honestly, not as a fabricated zero", () => {
    const fresh: WeeklyDigestCampaignSummary = {
      name: "New Launch",
      buzzScore: 12,
      postCount: 2,
      engagementDisplay: "40",
      sentiment: null,
      topHashtag: null,
    };
    const text = formatWeeklyDigest([fresh], GENERATED_AT);
    expect(text).toContain("Sentiment: pending — no posts classified yet");
    expect(text).toContain("Top hashtag: none tracked");
  });

  it("lists multiple campaigns in the order given", () => {
    const second: WeeklyDigestCampaignSummary = { ...CAMPAIGN, name: "NP50", buzzScore: 84 };
    const text = formatWeeklyDigest([CAMPAIGN, second], GENERATED_AT);
    expect(text.indexOf("Pluto Movie")).toBeLessThan(text.indexOf("NP50"));
  });
});
