import { describe, expect, it } from "vitest";
import { computeCohortStats } from "./cohort";
import { scorePost } from "./scorePost";
import { DEFAULT_THRESHOLD_PARAMS } from "./config";
import type { CohortStats, PostForScoring } from "./types";

const config = DEFAULT_THRESHOLD_PARAMS;

function post(overrides: Partial<PostForScoring>): PostForScoring {
  return {
    id: "post-1",
    likes: 10_000,
    comments: 500, // 20:1 — the clean-agency ratio observed in seed data
    postedAt: "2026-07-10T10:00:00.000Z", // 15:30 IST — normal hours
    ...overrides,
  };
}

// A cohort centered on the same "clean" 20:1 ratio/engagement as the default
// post fixture above, so scoring it lands near the middle of the scale.
const NEUTRAL_COHORT: CohortStats = {
  n: 10,
  meanEngagement: 10_500,
  stdEngagement: 2_000,
  meanLikeToCommentRatio: 20,
  stdLikeToCommentRatio: 5,
};

describe("scorePost", () => {
  it("scores a clean post with no flags and plausible mid-range scores", () => {
    const result = scorePost(post({}), NEUTRAL_COHORT, config);
    expect(result.flags).toEqual([]);
    expect(result.perfScore).toBeGreaterThan(30);
    expect(result.perfScore).toBeLessThan(70);
    expect(result.authScore).toBe(100);
    expect(result.effScore).toBeNull(); // not evaluated this phase — excluded from totalScore, see types.ts
    expect(result.totalScore).toBeGreaterThan(30);
    expect(result.totalScore).toBeLessThan(70);
  });

  it("fires engagement_velocity_anomaly alone for a high like:comment ratio", () => {
    // 22.1K likes / 88 comments ≈ 251:1 — BuzzBridge's seed numbers.
    const result = scorePost(
      post({ likes: 22_100, comments: 88, postedAt: "2026-07-10T10:00:00.000Z" }),
      NEUTRAL_COHORT,
      config,
    );
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0].type).toBe("engagement_velocity_anomaly");
    expect(result.flags[0].severity).toBe("high");
    expect(result.flags[0].evidence.likeToCommentRatio).toBeCloseTo(251.1, 0);
    expect(result.authScore).toBeLessThan(100);
  });

  it("fires off_hours_engagement_spike alone for a 2-4AM IST post", () => {
    // 2026-07-10T21:00:00Z + 5:30 = 02:30 IST, inside [2,4).
    const result = scorePost(post({ postedAt: "2026-07-10T21:00:00.000Z" }), NEUTRAL_COHORT, config);
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0].type).toBe("off_hours_engagement_spike");
    expect(result.flags[0].evidence.postedAtIstHour).toBe(2);
    expect(result.authScore).toBe(85); // 100 - medium(15)
  });

  it("computes totalScore from perf/auth renormalized to 100%, not a 50/30/20 blend with a hidden efficiency number", () => {
    // A degenerate cohort pins perfScore at exactly 50, so totalScore should
    // be perf(50)*0.625 + auth(85)*0.375 = 63.4375 — proof effScore isn't
    // silently contributing a 20% share (that would give 47.5 + 25.5 + 10 = 63
    // too, by coincidence-adjacent math, so the real regression guard is the
    // exact renormalized weight below, not just "some number near 60").
    const degenerate: CohortStats = {
      n: 1,
      meanEngagement: 10_500,
      stdEngagement: 0,
      meanLikeToCommentRatio: 20,
      stdLikeToCommentRatio: 0,
    };
    const result = scorePost(post({ postedAt: "2026-07-10T21:00:00.000Z" }), degenerate, config);
    expect(result.perfScore).toBe(50);
    expect(result.authScore).toBe(85);
    expect(result.effScore).toBeNull();
    const expectedTotal = (50 * config.weights.performance + 85 * config.weights.authenticity) / (config.weights.performance + config.weights.authenticity);
    expect(result.totalScore).toBeCloseTo(expectedTotal, 6);
  });

  it("fires both flags on one post and combines the authenticity penalty", () => {
    const result = scorePost(
      post({ likes: 22_100, comments: 88, postedAt: "2026-07-10T21:00:00.000Z" }),
      NEUTRAL_COHORT,
      config,
    );
    const types = result.flags.map((f) => f.type).sort();
    expect(types).toEqual(["engagement_velocity_anomaly", "off_hours_engagement_spike"]);
    expect(result.authScore).toBe(0); // velocity z-score alone (~46) already saturates the penalty at 100
  });

  it("does not divide by zero on a degenerate (single-post) cohort", () => {
    const degenerate: CohortStats = {
      n: 1,
      meanEngagement: 10_500,
      stdEngagement: 0,
      meanLikeToCommentRatio: 20,
      stdLikeToCommentRatio: 0,
    };
    const result = scorePost(post({}), degenerate, config);
    expect(result.perfScore).toBe(50);
    expect(result.effScore).toBeNull();
    expect(Number.isFinite(result.totalScore)).toBe(true);
    expect(result.flags).toEqual([]);
  });

  it("treats null likes/comments as zero without throwing", () => {
    const result = scorePost(post({ likes: null, comments: null }), NEUTRAL_COHORT, config);
    expect(Number.isFinite(result.totalScore)).toBe(true);
    expect(result.flags).toEqual([]);
  });

  it("handles zero comments without a divide-by-zero ratio", () => {
    const result = scorePost(post({ likes: 5_000, comments: 0 }), NEUTRAL_COHORT, config);
    expect(Number.isFinite(result.flags[0]?.evidence.likeToCommentRatio as number)).toBe(true);
    expect(result.flags[0].type).toBe("engagement_velocity_anomaly");
  });

  it("does not fire generic_comment_pattern when no commentTexts are given", () => {
    const result = scorePost(post({}), NEUTRAL_COHORT, config);
    expect(result.flags.find((f) => f.type === "generic_comment_pattern")).toBeUndefined();
  });

  it("fires generic_comment_pattern (medium) for 3+ identical comments on the same post", () => {
    const commentTexts = [
      { text: "Congratulations on the massive opening weekend team", authorHandle: "a" },
      { text: "Congratulations on the massive opening weekend team", authorHandle: "b" },
      { text: "Congratulations on the massive opening weekend team", authorHandle: "c" },
      { text: "So happy for you all", authorHandle: "d" },
    ];
    const result = scorePost(post({ commentTexts }), NEUTRAL_COHORT, config);
    const flag = result.flags.find((f) => f.type === "generic_comment_pattern");
    expect(flag?.severity).toBe("medium");
    expect(flag?.evidence.withinPostDuplicateCount).toBe(3);
    expect(result.authScore).toBe(80); // 100 - medium(20)
  });

  it("does not fire generic_comment_pattern on short repeated reactions (emoji, 'nice')", () => {
    const commentTexts = Array.from({ length: 5 }, (_, i) => ({ text: "🔥🔥🔥", authorHandle: `fan-${i}` }));
    const result = scorePost(post({ commentTexts }), NEUTRAL_COHORT, config);
    expect(result.flags.find((f) => f.type === "generic_comment_pattern")).toBeUndefined();
  });

  it("fires generic_comment_pattern (high) when the same comment text appears on a different post in the same run", () => {
    const scriptedText = "Bought my tickets already can't wait for this one to release";
    const crossPostDuplicateCounts = new Map([[scriptedText.toLowerCase(), 2]]);
    const commentTexts = [{ text: scriptedText, authorHandle: "bot1" }];
    const result = scorePost(post({ commentTexts }), NEUTRAL_COHORT, config, crossPostDuplicateCounts);
    const flag = result.flags.find((f) => f.type === "generic_comment_pattern");
    expect(flag?.severity).toBe("high");
    expect(flag?.evidence.crossPostDuplicatePostCount).toBe(2);
    expect(result.authScore).toBe(65); // 100 - high(35)
  });

  it("ranks flagged agencies' posts below clean agencies', at seed-realistic contamination (3 of 10 agencies, ~50 posts each)", () => {
    // Mirrors src/lib/providers/seed.ts's AGENCIES/POSTS: 7 clean agencies
    // clustered around a ~20:1 like:comment ratio, 3 flagged agencies (Buzz-
    // Bridge/Influx Kerala/NovaSocial-shaped) running 250-325:1, ~50 posts per
    // agency. This is the proportion the DPR's own example run assumes — a
    // synthetic 50/50 split (tried first) is a much harsher, unrepresentative
    // stress case that plain z-scores against a contaminated cohort can't
    // resolve at any penalty setting (the minority cluster's z-score is
    // mathematically capped once it's ~half the sample).
    const CLEAN_AGENCIES = [
      { likes: 18_400, comments: 920 },
      { likes: 15_100, comments: 741 },
      { likes: 11_800, comments: 590 },
      { likes: 10_400, comments: 512 },
      { likes: 9_800, comments: 440 },
      { likes: 9_100, comments: 398 },
      { likes: 8_400, comments: 360 },
    ];
    const FLAGGED_AGENCIES = [
      { likes: 22_100, comments: 88 },
      { likes: 20_800, comments: 64 },
      { likes: 19_400, comments: 72 },
    ];
    const POSTS_PER_AGENCY = 50;
    // Small deterministic jitter so posts within an agency aren't all identical.
    const jitter = (base: number, i: number) => Math.round(base * (1 + ((i % 7) - 3) * 0.01));

    function buildAgencyPosts(agencyId: string, base: { likes: number; comments: number }): PostForScoring[] {
      return Array.from({ length: POSTS_PER_AGENCY }, (_, i) => ({
        id: `${agencyId}-${i}`,
        likes: jitter(base.likes, i),
        comments: jitter(base.comments, i),
        postedAt: "2026-07-10T10:00:00.000Z",
      }));
    }

    const cleanGroups = CLEAN_AGENCIES.map((a, i) => buildAgencyPosts(`clean-${i}`, a));
    const flaggedGroups = FLAGGED_AGENCIES.map((a, i) => buildAgencyPosts(`flagged-${i}`, a));

    const all = [...cleanGroups, ...flaggedGroups].flat();
    const cohort = computeCohortStats(all);

    const meanTotalScore = (group: PostForScoring[]) => {
      const scores = group.map((p) => scorePost(p, cohort, config).totalScore);
      return scores.reduce((a, b) => a + b, 0) / scores.length;
    };

    const meanCleanScores = cleanGroups.map(meanTotalScore);
    const meanFlaggedScores = flaggedGroups.map(meanTotalScore);

    // Every flagged agency ranks below every clean agency — not just on
    // average, agency-by-agency, which is what an agency disputing a low
    // score would actually check (DoD #3).
    for (const flaggedScore of meanFlaggedScores) {
      for (const cleanScore of meanCleanScores) {
        expect(flaggedScore).toBeLessThan(cleanScore);
      }
    }
  });
});

describe("computeCohortStats", () => {
  it("returns zeroed stats for an empty run without throwing", () => {
    const cohort = computeCohortStats([]);
    expect(cohort.n).toBe(0);
    expect(cohort.meanEngagement).toBe(0);
    expect(cohort.stdEngagement).toBe(0);
  });
});
