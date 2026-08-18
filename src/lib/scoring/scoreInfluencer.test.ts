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

  it("still excludes reach (not fakes it) when only ONE popularity signal is missing, renormalizing over what's left", () => {
    // engagement present, reach missing — this is the "exclude one, keep going" case,
    // distinct from the "both popularity signals missing" case below.
    const result = scoreInfluencer({
      followersAvailable: false,
      followers: null,
      engagementRatePct: 15,
      consistencyScore01: 0.5,
      contentMixClipsPct: 60,
    });
    expect(result.components.reach).toBeNull();
    expect(result.components.engagement).not.toBeNull();
    expect(result.components.consistency).toBe(50);
    expect(result.components.contentMix).toBe(60);
    expect(result.buzzFactor).toBeGreaterThan(0);
  });

  it("withholds the buzz factor (0) when BOTH reach and engagement are unmeasurable, rather than scoring purely on consistency/content-mix", () => {
    // Real bug, caught against live data (2026-08-18): 5 real accounts with
    // followers_count_available:false (so engagement rate couldn't be computed either)
    // scored 82-97 — ranking at the very top of a real 202-account batch — purely because
    // consistency+content-mix got renormalized to 100% of the score. Neither signal
    // measures popularity; a bare "% of posts that are reels" isn't a buzz factor.
    const result = scoreInfluencer({
      followersAvailable: false,
      followers: null,
      engagementRatePct: null,
      consistencyScore01: 0.5,
      contentMixClipsPct: 97, // the exact shape of the real "poohlaala" account that scored 97
    });
    expect(result.components.reach).toBeNull();
    expect(result.components.engagement).toBeNull();
    // The individual numbers are still real and still shown — only the aggregate is
    // withheld, so someone looking at the data table can still see what WAS measured.
    expect(result.components.consistency).toBe(50);
    expect(result.components.contentMix).toBe(97);
    expect(result.buzzFactor).toBe(0);
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
