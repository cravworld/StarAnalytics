// Phase 3 scoring types — see AGENTS.md Phase 3 §2-4 and the plan's cohort-scope
// rationale. Everything here is pure data; scorePost.ts is the only place these
// get turned into numbers.

export type FlagType =
  | "engagement_velocity_anomaly"
  | "low_save_to_like_ratio"
  | "off_hours_engagement_spike"
  | "generic_comment_pattern";

export interface Flag {
  type: FlagType;
  evidence: Record<string, unknown>;
  severity: "low" | "medium" | "high";
}

// Coverage metadata, not per-post output. low_save_to_like_ratio and
// generic_comment_pattern never fire — they're missing-data gaps, not signals
// that came back clean — so they must never appear as an absent Flag (which
// would read identically to "checked, found nothing"). One registry backs both
// the Authenticity Audit's "not evaluated" panel and the All-Posts flag chips
// (DoD #5), so the two views can't drift out of sync with each other.
export interface FlagTypeInfo {
  type: FlagType;
  status: "implemented" | "not_evaluated";
  reason?: string;
}

export const FLAG_REGISTRY: FlagTypeInfo[] = [
  { type: "engagement_velocity_anomaly", status: "implemented" },
  { type: "off_hours_engagement_spike", status: "implemented" },
  {
    type: "low_save_to_like_ratio",
    status: "not_evaluated",
    reason: "saves unavailable for third-party posts",
  },
  // Implemented 2026-08-04 on top of the per-comment scrape/sentiment pipeline that shipped
  // since this was first scoped — the "requires commenter-profile data outside current scrape
  // scope" reason no longer applies; comment text is captured for every scraped post now.
  { type: "generic_comment_pattern", status: "implemented" },
];

export interface PostForScoring {
  id: string;
  likes: number | null;
  comments: number | null;
  postedAt: string | null; // ISO, UTC, as stored in posts.posted_at
  // Optional: only present when the caller has already scraped comments for this post (see
  // agency.ts, which awaits queueSentimentClassification — and therefore the comment scrape —
  // before scoring). Omitted or empty just means generic_comment_pattern finds no evidence for
  // this post, same as any other "checked, found nothing" flag — never a coverage gap.
  commentTexts?: { text: string | null; authorHandle: string | null }[];
}

export interface CohortStats {
  n: number;
  meanEngagement: number; // likes+comments, across every post in the run
  stdEngagement: number;
  meanLikeToCommentRatio: number;
  stdLikeToCommentRatio: number;
}

// No reach, follower, or spend data exists for scraped third-party posts, so
// there is no efficiency signal independent of the same raw engagement
// perfScore already measures this phase. An "engagement per post vs. peer
// agencies" proxy was tried and rejected: it double-counted perfScore's own
// signal through a second weighted channel, and inflated (fraudulent)
// engagement ended up buying back exactly the points authScore's penalty had
// just taken away — verified empirically in scorePost.test.ts's cross-agency
// ranking test, which fails against that version. A flat neutral placeholder
// (tried next) was worse, not better: blended silently into totalScore, it's
// indistinguishable from a real measurement to anyone reading the number, the
// same "0 detected reads as clean" failure mode the two not-evaluated flag
// types exist to avoid — just relocated to a score component instead of a
// flag. effScore is therefore null (not evaluated) until a real signal
// exists — reach/follower/spend data, or a defined notion of what
// "efficiency" means beyond the DPR's label — and excluded from totalScore
// entirely rather than averaged in.
export const EFFICIENCY_NOT_EVALUATED_REASON =
  "no reach, follower, or spend data available to measure efficiency independently of performance";

export interface ThresholdConfigParams {
  // Efficiency's weight is retained here (not deleted) so a future phase that
  // adds a real signal can turn it back on without a schema change — it is
  // NOT applied to totalScore while effScore is null; see scorePost.ts, which
  // renormalizes performance/authenticity to sum to 1 in the meantime.
  weights: { performance: number; authenticity: number; efficiency: number }; // 0.5/0.3/0.2 per DPR
  velocityZCutoffMedium: number;
  velocityZCutoffHigh: number;
  // Authenticity penalty for the velocity flag scales with how far zRatio sits
  // above 0, not a flat per-severity bucket. This is deliberate: a cohort that
  // includes the fraudulent posts themselves has its mean/stddev pulled toward
  // them, which mathematically caps how large a z-score an outlier can reach
  // (bounded by roughly sqrt(cleanFraction/fraudFraction) — see
  // scorePost.test.ts's cross-agency ranking test for the derivation). perfScore
  // and effScore both reward the same inflated raw engagement at the same time,
  // so a flat penalty bucket is never guaranteed to outweigh that combined
  // gain. A penalty proportional to the (capped-but-still-elevated) z-score
  // scales with it instead, and is more defensible in a dispute anyway: "the
  // penalty tracks how anomalous the evidence is" beats "a fixed number
  // regardless of severity."
  velocityPenaltyPerZ: number;
  offHoursStartIst: number; // inclusive hour, 0-23
  offHoursEndIst: number; // exclusive hour, 0-23
  offHoursSeverity: "low" | "medium" | "high";
  // Minimum identical (normalized) comments on the SAME post before generic_comment_pattern
  // fires on within-post clustering — see scorePost.ts's detectGenericCommentPattern.
  genericCommentMinDuplicates: number;
}

export interface ScoreResult {
  perfScore: number;
  authScore: number;
  // null: not evaluated this phase — see EFFICIENCY_NOT_EVALUATED_REASON.
  // Never a placeholder number; totalScore is computed from perf/auth alone.
  effScore: number | null;
  totalScore: number;
  flags: Flag[];
}
