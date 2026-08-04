import { describe, expect, it } from "vitest";
import { computeBuzzScore } from "./buzzScore";

describe("computeBuzzScore", () => {
  it("scores a large, positive, accelerating campaign near the top of the scale", () => {
    const result = computeBuzzScore({
      postCount: 175,
      hourlyVolume: [1, 1, 2, 2, 3, 4, 5, 6, 8, 10, 12, 15],
      sentiment: { positivePct: 80, negativePct: 5 },
    });
    expect(result.score).toBeGreaterThan(80);
    expect(result.components.size).toBeGreaterThan(90);
    expect(result.components.momentum).toBeGreaterThan(50);
    expect(result.components.sentiment).toBe(Math.round(50 + (80 - 5) / 2)); // 88
  });

  it("scores a tiny, negative, fading campaign near the bottom", () => {
    const result = computeBuzzScore({
      postCount: 2,
      hourlyVolume: [4, 3, 2, 1, 0, 0],
      sentiment: { positivePct: 5, negativePct: 80 },
    });
    expect(result.score).toBeLessThan(20);
    expect(result.components.momentum).toBeLessThan(50);
  });

  it("returns 0 size for a zero-post campaign without dividing by zero", () => {
    const result = computeBuzzScore({ postCount: 0, hourlyVolume: [], sentiment: null });
    expect(result.components.size).toBe(0);
    expect(Number.isFinite(result.score)).toBe(true);
  });

  it("excludes sentiment (not fakes a neutral 50) when no posts are classified yet — renormalized weights land on a genuinely different number than a neutral-50 fill would", () => {
    // size(20 posts) ~= 57.4, momentum(flat [2,2,2,2]) = 50 — both cases share these.
    const withSentiment = computeBuzzScore({
      postCount: 20,
      hourlyVolume: [2, 2, 2, 2],
      sentiment: { positivePct: 50, negativePct: 50 }, // sentimentScore = 50, same value the "missing" case would fake
    });
    const withoutSentiment = computeBuzzScore({
      postCount: 20,
      hourlyVolume: [2, 2, 2, 2],
      sentiment: null,
    });
    expect(withoutSentiment.components.sentiment).toBeNull();
    // (57.4*0.4 + 50*0.2 + 50*0.4) / 1.0 = 52.96 -> 53
    expect(withSentiment.score).toBe(53);
    // (57.4*0.4 + 50*0.2) / 0.6 = 54.93 -> 55 — different from 53, proving the null case is a
    // real renormalization, not a silent "treat missing sentiment as 50" shortcut that would
    // have produced the same 53.
    expect(withoutSentiment.score).toBe(55);
    expect(withoutSentiment.score).not.toBe(withSentiment.score);
  });

  it("treats a flat hourly volume (equal halves) as neutral momentum (50)", () => {
    const result = computeBuzzScore({
      postCount: 10,
      hourlyVolume: [3, 3, 3, 3],
      sentiment: { positivePct: 50, negativePct: 50 },
    });
    expect(result.components.momentum).toBe(50);
  });

  it("does not throw or return NaN on a single-bucket hourlyVolume", () => {
    const result = computeBuzzScore({ postCount: 1, hourlyVolume: [1], sentiment: null });
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.components.momentum).toBe(50);
  });

  it("clamps the final score to [0, 100]", () => {
    const result = computeBuzzScore({
      postCount: 1000,
      hourlyVolume: [1, 100],
      sentiment: { positivePct: 100, negativePct: 0 },
    });
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});
