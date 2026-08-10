import { describe, it, expect } from "vitest";
import { evaluateFollowerLoss, DEFAULT_FOLLOWER_LOSS_PARAMS } from "./followerLossAlerts";

describe("evaluateFollowerLoss", () => {
  it("does not alert on growth", () => {
    const v = evaluateFollowerLoss(1000, 1050);
    expect(v.shouldAlert).toBe(false);
    expect(v.dropAbsolute).toBe(0);
  });

  it("does not alert on a flat count", () => {
    const v = evaluateFollowerLoss(1000, 1000);
    expect(v.shouldAlert).toBe(false);
  });

  it("does not alert on a drop below the percentage threshold", () => {
    // 1% drop, threshold is 3% — real decline, just not big enough to page anyone about.
    const v = evaluateFollowerLoss(1000, 990);
    expect(v.shouldAlert).toBe(false);
    expect(v.dropPct).toBeCloseTo(1, 5);
  });

  it("alerts on a drop at or above the percentage threshold", () => {
    // Exactly 3%, at DEFAULT_FOLLOWER_LOSS_PARAMS.dropPctThreshold — boundary is inclusive.
    const v = evaluateFollowerLoss(1000, 970);
    expect(v.shouldAlert).toBe(true);
    expect(v.dropPct).toBeCloseTo(3, 5);
    expect(v.dropAbsolute).toBe(30);
  });

  it("alerts on a larger drop with correct pct/absolute values", () => {
    const v = evaluateFollowerLoss(50000, 45000);
    expect(v.shouldAlert).toBe(true);
    expect(v.dropPct).toBeCloseTo(10, 5);
    expect(v.dropAbsolute).toBe(5000);
  });

  // The whole point of the floor: a tiny account can lose a huge percentage from
  // completely normal noise (1 of 5 followers = 20%) — must not fire on that.
  it("never alerts below the minimum-followers floor, even on a large percentage drop", () => {
    const v = evaluateFollowerLoss(5, 1);
    expect(v.shouldAlert).toBe(false);
  });

  it("respects custom params instead of always using the defaults", () => {
    const strict = evaluateFollowerLoss(1000, 990, { dropPctThreshold: 0.5, minFollowersForCheck: 100 });
    expect(strict.shouldAlert).toBe(true); // 1% drop clears a 0.5% threshold

    const lenient = evaluateFollowerLoss(1000, 970, { dropPctThreshold: 10, minFollowersForCheck: 100 });
    expect(lenient.shouldAlert).toBe(false); // 3% drop doesn't clear a 10% threshold
  });

  it("default params are a real 3% threshold with a 100-follower floor", () => {
    expect(DEFAULT_FOLLOWER_LOSS_PARAMS.dropPctThreshold).toBe(3);
    expect(DEFAULT_FOLLOWER_LOSS_PARAMS.minFollowersForCheck).toBe(100);
  });
});
