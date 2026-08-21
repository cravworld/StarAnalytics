// Derived metrics for tracked campaign posts. Pure functions, no I/O — same discipline as
// scoring/buzzScore.ts and scoring/scorePost.ts.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: a metric that could not be measured returns null,
// never 0. Instagram never reports shares or reach; a private account reports no follower
// count; a photo has no play count. Coalescing any of those to zero produces a number that
// looks measured and isn't — the failure CAMPAIGN-POST-TRACKING.md §1 is written around.
// Every function here returns `number | null` for that reason, and callers must render
// null as "—", never as "0".

export interface PostMetrics {
  likes: number | null;
  comments: number | null;
  shares: number | null;
  views: number | null;
}

/**
 * Total engagement — the ONLY cross-platform axis.
 *
 * Deliberately just likes + comments, even though Facebook also reports shares: adding
 * shares would make a Facebook post's total structurally larger than an Instagram post's
 * for the same real performance, and the campaign totals mix all three platforms. Shares
 * are surfaced separately as a Facebook-native metric instead.
 *
 * Null only when BOTH inputs are null (nothing was measured). A platform reporting likes
 * but not comments still yields a usable total from what it did report.
 */
export function engagement(m: Pick<PostMetrics, "likes" | "comments">): number | null {
  if (m.likes === null && m.comments === null) return null;
  return (m.likes ?? 0) + (m.comments ?? 0);
}

/**
 * Engagement rate — (likes + comments) / followers * 100.
 *
 * This exact formula matters: it is the one easy_scraper/instagram-profile-engagement-
 * analytics uses for `average_engagement_rate_pct`, per the formulas recorded in
 * providers/apify-scout-normalize.ts (documented there from the actor's own Store page,
 * 2026-08-17). Keeping them identical is what makes baselineDelta() below a legitimate
 * comparison rather than a units mismatch. If either side's formula ever changes, that
 * comparison must be removed, not silently left to drift.
 *
 * Null when followers is unknown or zero — a rate against an unknown or zero denominator
 * is not a small number, it is not a number.
 */
export function engagementRatePct(
  m: Pick<PostMetrics, "likes" | "comments">,
  followers: number | null,
): number | null {
  if (followers === null || followers <= 0) return null;
  const total = engagement(m);
  if (total === null) return null;
  return (total / followers) * 100;
}

/**
 * How this post's engagement rate compares with the account's own historical average,
 * as a percentage difference. Positive means the paid post beat their normal output.
 *
 * This is the headline number of the whole feature: it answers "did the post we paid for
 * do better or worse than what they post for free," which no absolute figure can.
 *
 * Both sides must be the same formula (see engagementRatePct above). The baseline comes
 * from ScoutSnapshot.engagementRatePct and therefore only exists for accounts that went
 * through Scoutline; it was also measured against that account's follower count at scan
 * time, not today's. Callers must label it with its scan date and omit it entirely for
 * accounts with no Scoutline history — never substitute a campaign-wide average, which
 * would silently change what the number means.
 */
export function baselineDeltaPct(
  postErPct: number | null,
  baselineErPct: number | null,
): number | null {
  if (postErPct === null || baselineErPct === null || baselineErPct <= 0) return null;
  return ((postErPct - baselineErPct) / baselineErPct) * 100;
}

/**
 * Share of engagement that is comments rather than likes, 0-1.
 *
 * Separates conversation from passive scrolling. A high ratio on modest likes often matters
 * more to a campaign than the reverse, and a ratio wildly out of line with an account's own
 * norm is a cheap tell for engagement-pod behaviour.
 */
export function commentRatio(m: Pick<PostMetrics, "likes" | "comments">): number | null {
  const total = engagement(m);
  if (total === null || total === 0 || m.comments === null) return null;
  return m.comments / total;
}

/**
 * views / followers — reels, videos and YouTube only.
 *
 * Above 1.0 means the post travelled beyond the account's own follower base. This is the
 * closest honest proxy for "did this spread" that exists without reach, and it is NOT
 * reach: a play count counts video starts, not distinct people, and the same viewer
 * replaying is counted again. Never label it "reach" in the UI.
 */
export function viewRate(views: number | null, followers: number | null): number | null {
  if (views === null || followers === null || followers <= 0) return null;
  return views / followers;
}

/**
 * Engagement gained per day between two snapshots.
 *
 * Needs two scans to mean anything, which is the reason tracked_post_snapshots exists as an
 * append-only table rather than the current metrics being overwritten in place.
 *
 * Returns null rather than Infinity when the two snapshots are less than a minute apart —
 * that is a double-scan, not a measurement, and dividing by a near-zero interval produces a
 * spectacular fake velocity.
 */
export function velocityPerDay(
  current: { engagement: number | null; at: Date },
  previous: { engagement: number | null; at: Date },
): number | null {
  if (current.engagement === null || previous.engagement === null) return null;
  const ms = current.at.getTime() - previous.at.getTime();
  if (ms < 60_000) return null;
  const days = ms / 86_400_000;
  return (current.engagement - previous.engagement) / days;
}

/**
 * Percentile rank of `value` within `all` (0-100). Used for "this post is in the top 10%
 * of the campaign".
 *
 * Nulls are excluded from the population rather than treated as zero — a post whose
 * engagement was never measured must not drag down the ranking of posts that were.
 */
export function percentileRank(value: number | null, all: (number | null)[]): number | null {
  if (value === null) return null;
  const measured = all.filter((v): v is number => v !== null);
  if (measured.length === 0) return null;
  const below = measured.filter((v) => v < value).length;
  return (below / measured.length) * 100;
}

export interface AggregateTotals {
  posts: number;
  /** Sum of likes across posts that reported likes. */
  likes: number | null;
  comments: number | null;
  shares: number | null;
  views: number | null;
  engagement: number | null;
  /**
   * How many posts actually reported each metric. This is what lets the UI say
   * "Views: 12 of 34 posts" instead of implying the total covers everything — the
   * difference between an honest aggregate and a misleading one.
   */
  coverage: { likes: number; comments: number; shares: number; views: number };
}

/**
 * Campaign/account rollup.
 *
 * Sums only what was measured and reports the coverage alongside, so a total is never
 * mistaken for a complete one. A metric no post reported at all comes back null, not 0 —
 * "no Instagram post reports shares" and "every post got zero shares" are different facts
 * and must not render identically.
 */
export function aggregate(posts: PostMetrics[]): AggregateTotals {
  const coverage = { likes: 0, comments: 0, shares: 0, views: 0 };
  let likes = 0;
  let comments = 0;
  let shares = 0;
  let views = 0;

  for (const p of posts) {
    if (p.likes !== null) {
      likes += p.likes;
      coverage.likes++;
    }
    if (p.comments !== null) {
      comments += p.comments;
      coverage.comments++;
    }
    if (p.shares !== null) {
      shares += p.shares;
      coverage.shares++;
    }
    if (p.views !== null) {
      views += p.views;
      coverage.views++;
    }
  }

  const totalEngagement =
    coverage.likes === 0 && coverage.comments === 0 ? null : likes + comments;

  return {
    posts: posts.length,
    likes: coverage.likes > 0 ? likes : null,
    comments: coverage.comments > 0 ? comments : null,
    shares: coverage.shares > 0 ? shares : null,
    views: coverage.views > 0 ? views : null,
    engagement: totalEngagement,
    coverage,
  };
}
