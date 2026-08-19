import { describe, it, expect } from "vitest";
import {
  buildSpikeMessage,
  evaluateNegativeSpike,
  DEFAULT_NEGATIVE_SPIKE_PARAMS as P,
} from "./negativeSentimentAlerts";

// The live corpus (2026-08-07) sits at 28 negatives in 1,636 classified comments = 1.7%.
// Several cases below use that as the baseline so the thresholds are tested against the
// real distribution rather than invented round numbers.
describe("evaluateNegativeSpike", () => {
  it("does not fire on a tiny sample, however bad the ratio looks", () => {
    // 2 of 3 is 67% negative and means nothing.
    const v = evaluateNegativeSpike({
      recentNegative: 2,
      recentClassified: 3,
      baselineNegative: 28,
      baselineClassified: 1636,
    });
    expect(v.shouldAlert).toBe(false);
    expect(v.reason).toBe("below_minimums");
  });

  it("requires the absolute negative floor even with a large denominator", () => {
    const v = evaluateNegativeSpike({
      recentNegative: P.minRecentNegatives - 1,
      recentClassified: 500,
      baselineNegative: 0,
      baselineClassified: 1000,
    });
    expect(v.shouldAlert).toBe(false);
    expect(v.reason).toBe("below_minimums");
  });

  it("fires on a clear multiple of a normal baseline", () => {
    // 5% recent vs 1.7% baseline — comfortably over 2x, under the 10% floor, so this
    // specifically exercises the multiple branch rather than the floor.
    const v = evaluateNegativeSpike({
      recentNegative: 5,
      recentClassified: 100,
      baselineNegative: 28,
      baselineClassified: 1636,
    });
    expect(v.shouldAlert).toBe(true);
    expect(v.reason).toBe("above_baseline_multiple");
    expect(v.recentPct).toBe(5);
    expect(v.baselinePct).toBe(1.7);
  });

  it("stays quiet when the rate is merely normal", () => {
    const v = evaluateNegativeSpike({
      recentNegative: 3,
      recentClassified: 150,
      baselineNegative: 28,
      baselineClassified: 1636,
    });
    expect(v.shouldAlert).toBe(false);
    expect(v.reason).toBe("within_normal_range");
  });

  // A campaign that is already going badly has no useful multiple left to exceed — the
  // floor is what keeps it alertable.
  it("fires on the absolute floor when the baseline is already high", () => {
    const v = evaluateNegativeSpike({
      recentNegative: 30,
      recentClassified: 100,
      baselineNegative: 250,
      baselineClassified: 1000,
    });
    expect(v.shouldAlert).toBe(true);
    expect(v.reason).toBe("above_floor");
  });

  // Any negative at all is an infinite multiple of zero. Without this guard the first
  // negative comment on a previously spotless campaign would always page someone.
  it("treats a zero baseline as no baseline, not as an infinite multiple", () => {
    const v = evaluateNegativeSpike({
      recentNegative: 4,
      recentClassified: 100,
      baselineNegative: 0,
      baselineClassified: 800,
    });
    expect(v.shouldAlert).toBe(false);
    expect(v.reason).toBe("within_normal_range");
    expect(v.baselinePct).toBe(0);
  });

  it("reports a null baseline when nothing was classified in the prior window", () => {
    const v = evaluateNegativeSpike({
      recentNegative: 12,
      recentClassified: 100,
      baselineNegative: 0,
      baselineClassified: 0,
    });
    expect(v.baselinePct).toBeNull();
    // Still alertable — via the floor, which needs no baseline.
    expect(v.shouldAlert).toBe(true);
    expect(v.reason).toBe("above_floor");
  });
});

describe("buildSpikeMessage", () => {
  it("states both rates when a baseline exists", () => {
    const input = { recentNegative: 5, recentClassified: 100, baselineNegative: 28, baselineClassified: 1636 };
    const msg = buildSpikeMessage("Pluto Movie", evaluateNegativeSpike(input), input);
    expect(msg).toBe(
      "Pluto Movie: 5 of 100 new comments negative (5%) in the last 24h — up from 1.7% over the prior 14 days.",
    );
  });

  it("says so plainly when there is no baseline, rather than implying one", () => {
    const input = { recentNegative: 12, recentClassified: 100, baselineNegative: 0, baselineClassified: 0 };
    const msg = buildSpikeMessage("NP50", evaluateNegativeSpike(input), input);
    expect(msg).toContain("No prior 14-day baseline");
  });
});
