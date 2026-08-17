// Normalizer for easy_scraper/instagram-profile-engagement-analytics — Scoutline's sole data
// source (2026-08-17 direction: no profile/post/comment-scraper pass for this feature, one
// actor does the whole bulk scan). Field names confirmed against two live API runs against
// real accounts from the "BKU X Snakeplant.pdf" list, plus the actor's documented formulas
// (fetched from its Apify Store page the same day):
//
//   average_engagement_rate_pct = mean of (likes+comments)/followers*100 per analyzed post.
//     A value well over 100% is real, not a bug — confirmed on a real 5.8k-follower account
//     whose reels reach far beyond its follower count via non-follower algorithmic reach.
//   engagement_consistency_score = 1 - (stddev of per-post engagement / mean), clipped 0-1.
//     0 means genuinely spiky (one viral outlier among flat posts), not a broken metric.
//   comment_rate_pct = comments/followers*100.
//   cross_platform_amplification_rate_pct = FB likes / IG likes, only when FB data exists —
//     not used here; irrelevant noise for the vast majority of Instagram-only accounts.
//
// `followers_count_available: false` (confirmed live on a real account with a hidden
// follower count) nulls every ratio metric that depends on followers — normalized straight
// through as null, never backfilled with a guess.

type ActorItem = Record<string, unknown>;

function str(item: ActorItem, key: string): string | null {
  const v = item[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(item: ActorItem, key: string): number | null {
  const v = item[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function bool(item: ActorItem, key: string): boolean {
  return item[key] === true;
}

export interface NormalizedScoutItem {
  profileUsername: string | null;
  followers: number | null;
  followersAvailable: boolean;
  postsAnalyzed: number;
  engagementRatePct: number | null;
  commentRatePct: number | null;
  consistencyScore01: number | null;
  postingFrequencyPerWeek: number | null;
  contentMixClipsPct: number | null;
  contentMixCarouselPct: number | null;
  contentMixImagePct: number | null;
  mostEngagedPostUrl: string | null;
  note: string | null;
  raw: ActorItem;
}

export function normalizeScoutItem(item: ActorItem): NormalizedScoutItem {
  return {
    profileUsername: str(item, "profile_username"),
    followers: num(item, "followers_count"),
    followersAvailable: bool(item, "followers_count_available"),
    postsAnalyzed: num(item, "total_posts_analyzed") ?? 0,
    engagementRatePct: num(item, "average_engagement_rate_pct"),
    commentRatePct: num(item, "comment_rate_pct"),
    consistencyScore01: num(item, "engagement_consistency_score"),
    postingFrequencyPerWeek: num(item, "posting_frequency_posts_per_week"),
    contentMixClipsPct: num(item, "content_mix_clips_pct"),
    contentMixCarouselPct: num(item, "content_mix_carousel_pct"),
    contentMixImagePct: num(item, "content_mix_image_pct"),
    mostEngagedPostUrl: str(item, "most_engaged_post_link"),
    note: str(item, "note"),
    raw: item,
  };
}
