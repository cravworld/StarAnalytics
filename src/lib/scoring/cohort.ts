import type { CohortStats, PostForScoring } from "./types";

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function stddev(xs: number[], m: number): number {
  if (xs.length === 0) return 0;
  const variance = mean(xs.map((x) => (x - m) ** 2));
  return Math.sqrt(variance);
}

// Cross-agency cohort, deliberately not per-agency: scoring a post against its
// own agency's mean would let an agency that buys engagement on most of its
// posts corrupt its own baseline and never flag itself. See the plan's
// "cohort scope" note. Input posts are every post scored in this run, across
// every agency.
//
// KNOWN LIMITATION, not addressed this phase: this cohort uses mean/stddev,
// which the fraudulent posts themselves pull toward them, capping how large a
// genuine outlier's z-score can reach (see scorePost.test.ts's cross-agency
// ranking test, and ThresholdConfigParams.velocityPenaltyPerZ's comment on
// why the z-cutoffs had to be tuned unusually low to compensate). The more
// principled fix is robust statistics — median and MAD (median absolute
// deviation) instead of mean/stddev — which are far less sensitive to
// contamination pulling its own reference point. Lowering the cutoff is a
// patch on the symptom; median/MAD would address the actual cause. Flagged
// here as a follow-up, not attempted now because MAD degenerates (MAD = 0) in
// exactly the "clean majority, tight minority cluster" shape this dataset
// has, and fixing that properly is more than a drop-in swap.
export function computeCohortStats(posts: PostForScoring[]): CohortStats {
  const engagements = posts.map((p) => (p.likes ?? 0) + (p.comments ?? 0));
  const ratios = posts.map((p) => (p.likes ?? 0) / Math.max(p.comments ?? 0, 1));
  const meanEngagement = mean(engagements);
  const meanLikeToCommentRatio = mean(ratios);

  return {
    n: posts.length,
    meanEngagement,
    stdEngagement: stddev(engagements, meanEngagement),
    meanLikeToCommentRatio,
    stdLikeToCommentRatio: stddev(ratios, meanLikeToCommentRatio),
  };
}
