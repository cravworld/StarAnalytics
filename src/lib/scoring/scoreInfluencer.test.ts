import { describe, expect, it } from "vitest";
import { scoreInfluencer } from "./scoreInfluencer";

describe("scoreInfluencer", () => {
  it("scores a strong micro-influencer (high engagement, low followers) well above a dormant big account", () => {
    const micro = scoreInfluencer({
      followersAvailable: true,
      followers: 5_856,
      engagementRatePct: 12,
      consistencyScore01: 0.7,
      contentMixClipsPct: 90,
    });
    const dormant = scoreInfluencer({
      followersAvailable: true,
      followers: 300_000,
      engagementRatePct: 0.1,
      consistencyScore01: 0.9,
      contentMixClipsPct: 10,
    });
    expect(micro.buzzFactor).toBeGreaterThan(dormant.buzzFactor);
  });

  it("does not clip a real >100% engagement rate to a degenerate max — it still discriminates from a merely-good rate", () => {
    const viral = scoreInfluencer({
      followersAvailable: true,
      followers: 5_856,
      engagementRatePct: 623.55,
      consistencyScore01: 0,
      contentMixClipsPct: 96.6,
    });
    const solid = scoreInfluencer({
      followersAvailable: true,
      followers: 5_856,
      engagementRatePct: 8,
      consistencyScore01: 0,
      contentMixClipsPct: 96.6,
    });
    expect(viral.components.engagement).toBeGreaterThan(solid.components.engagement!);
    expect(viral.components.engagement).toBeLessThanOrEqual(100);
  });

  it("excludes reach/engagement (not fakes them) when followers_count is unavailable, renormalizing over the remaining components", () => {
    const result = scoreInfluencer({
      followersAvailable: false,
      followers: null,
      engagementRatePct: null,
      consistencyScore01: 0.5,
      contentMixClipsPct: 60,
    });
    expect(result.components.reach).toBeNull();
    expect(result.components.engagement).toBeNull();
    expect(result.components.consistency).toBe(50);
    expect(result.components.contentMix).toBe(60);
    expect(Number.isFinite(result.buzzFactor)).toBe(true);
    expect(result.buzzFactor).toBeGreaterThan(0);
  });

  it("returns a 0 buzz factor with every component null for a totally unmeasurable account, without dividing by zero", () => {
    const result = scoreInfluencer({
      followersAvailable: false,
      followers: null,
      engagementRatePct: null,
      consistencyScore01: null,
      contentMixClipsPct: null,
    });
    expect(result.buzzFactor).toBe(0);
    expect(result.components).toEqual({ reach: null, engagement: null, consistency: null, contentMix: null });
  });
});
