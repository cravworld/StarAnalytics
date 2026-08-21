import { describe, it, expect } from "vitest";
import {
  aggregate,
  baselineDeltaPct,
  commentRatio,
  engagement,
  engagementRatePct,
  percentileRank,
  velocityPerDay,
  viewRate,
} from "./insights";

// Every test in this file exists to pin one property: an unmeasurable metric is null, and
// null never becomes 0. See CAMPAIGN-POST-TRACKING.md §1 — a fabricated zero is the failure
// this whole feature is designed around.

describe("engagement", () => {
  it("is likes + comments", () => {
    expect(engagement({ likes: 100, comments: 20 })).toBe(120);
  });

  it("is null only when nothing at all was measured", () => {
    expect(engagement({ likes: null, comments: null })).toBeNull();
  });

  it("still totals what was measured when one side is missing", () => {
    expect(engagement({ likes: 100, comments: null })).toBe(100);
  });

  // Facebook reports shares; Instagram and YouTube never do. Including them would make FB
  // posts structurally larger than IG posts for the same real performance.
  it("excludes shares so the cross-platform axis stays comparable", () => {
    const withShares = { likes: 10, comments: 5, shares: 1000, views: null };
    expect(engagement(withShares)).toBe(15);
  });
});

describe("engagementRatePct", () => {
  it("is (likes + comments) / followers * 100", () => {
    expect(engagementRatePct({ likes: 90, comments: 10 }, 1000)).toBeCloseTo(10);
  });

  it("is null when the follower count is unknown", () => {
    expect(engagementRatePct({ likes: 90, comments: 10 }, null)).toBeNull();
  });

  it("is null rather than Infinity when followers is zero", () => {
    expect(engagementRatePct({ likes: 90, comments: 10 }, 0)).toBeNull();
  });
});

describe("baselineDeltaPct", () => {
  // The headline number: did the paid post beat what they post for free?
  it("is positive when the post beat the account's own average", () => {
    expect(baselineDeltaPct(6, 4)).toBeCloseTo(50);
  });

  it("is negative when the paid post underperformed", () => {
    expect(baselineDeltaPct(3, 5)).toBeCloseTo(-40);
  });

  it("is null when the account has no Scoutline baseline", () => {
    expect(baselineDeltaPct(6, null)).toBeNull();
  });

  it("is null when this post's own rate could not be computed", () => {
    expect(baselineDeltaPct(null, 4)).toBeNull();
  });
});

describe("commentRatio", () => {
  it("is comments over total engagement", () => {
    expect(commentRatio({ likes: 75, comments: 25 })).toBeCloseTo(0.25);
  });

  it("is null when there is no engagement to divide", () => {
    expect(commentRatio({ likes: 0, comments: 0 })).toBeNull();
    expect(commentRatio({ likes: null, comments: null })).toBeNull();
  });
});

describe("viewRate", () => {
  it("goes above 1 when a post travelled past the follower base", () => {
    expect(viewRate(15000, 5000)).toBeCloseTo(3);
  });

  // A photo has no play count at all — that is not a zero-view post.
  it("is null when the platform reported no views", () => {
    expect(viewRate(null, 5000)).toBeNull();
  });
});

describe("velocityPerDay", () => {
  const t0 = new Date("2026-08-01T00:00:00Z");

  it("is engagement gained per day between two snapshots", () => {
    const t2 = new Date("2026-08-03T00:00:00Z");
    expect(velocityPerDay({ engagement: 500, at: t2 }, { engagement: 100, at: t0 })).toBeCloseTo(200);
  });

  // Two scans a few seconds apart is a double-scan, not a measurement. Dividing by that
  // interval yields a spectacular fake velocity.
  it("is null when the two snapshots are less than a minute apart", () => {
    const almost = new Date(t0.getTime() + 30_000);
    expect(velocityPerDay({ engagement: 500, at: almost }, { engagement: 100, at: t0 })).toBeNull();
  });

  it("is null when either snapshot has no engagement figure", () => {
    const t2 = new Date("2026-08-03T00:00:00Z");
    expect(velocityPerDay({ engagement: null, at: t2 }, { engagement: 100, at: t0 })).toBeNull();
  });
});

describe("percentileRank", () => {
  it("ranks a value against the measured population", () => {
    expect(percentileRank(30, [10, 20, 30, 40])).toBeCloseTo(50);
  });

  // A post that was never measured must not drag down the posts that were.
  it("excludes nulls from the population rather than counting them as zero", () => {
    expect(percentileRank(30, [10, 20, 30, 40])).toBe(percentileRank(30, [10, null, 20, 30, null, 40]));
  });

  it("is null when nothing in the population was measured", () => {
    expect(percentileRank(30, [null, null])).toBeNull();
  });
});

describe("aggregate", () => {
  const posts = [
    { likes: 100, comments: 10, shares: null, views: 5000 }, // instagram reel
    { likes: 200, comments: 20, shares: null, views: null }, // instagram photo
    { likes: 50, comments: 5, shares: 12, views: 900 }, // facebook
  ];

  it("sums each metric across the posts that reported it", () => {
    const t = aggregate(posts);
    expect(t.likes).toBe(350);
    expect(t.comments).toBe(35);
    expect(t.engagement).toBe(385);
    expect(t.views).toBe(5900);
    expect(t.shares).toBe(12);
  });

  // This is what lets the UI say "Views: 2 of 3 posts" rather than implying the total
  // covers everything.
  it("reports how many posts backed each total", () => {
    const t = aggregate(posts);
    expect(t.coverage).toEqual({ likes: 3, comments: 3, shares: 1, views: 2 });
  });

  // "No post reports shares" and "every post got zero shares" are different facts and must
  // not render identically.
  it("returns null, not 0, for a metric no post reported", () => {
    const igOnly = [
      { likes: 10, comments: 1, shares: null, views: null },
      { likes: 20, comments: 2, shares: null, views: null },
    ];
    const t = aggregate(igOnly);
    expect(t.shares).toBeNull();
    expect(t.views).toBeNull();
    expect(t.coverage.shares).toBe(0);
  });

  it("handles an empty campaign without inventing zeros", () => {
    const t = aggregate([]);
    expect(t.posts).toBe(0);
    expect(t.engagement).toBeNull();
    expect(t.likes).toBeNull();
  });
});
