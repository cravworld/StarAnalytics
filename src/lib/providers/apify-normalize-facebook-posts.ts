// Normalizer for apify/facebook-posts-scraper — Campaign Post Tracking's Facebook source.
//
// WHY A PAGE SCRAPER FOR A POST-LEVEL FEATURE: Apify's official Facebook lineup has no
// actor that takes a post URL and returns that post's engagement. Seventeen official
// actors, all organised by container (page, group, event, hashtag, search). The two that
// do accept post URLs return lists of PEOPLE, not metrics — facebook-comments-scraper
// returns comment rows, and facebook-likes-scraper returns one row per reactor with their
// name, profile URL and photo (and only a ~20-row preview, so it can't even produce a true
// count). That last one would also be a mass harvest of uninvolved third parties, which is
// the opposite of the data-minimization pass in apify-normalize.ts.
//
// So the only honest route is: scrape the post's page, match our post ID out of the
// results. `onlyPostsNewerThan` bounds that scrape by date, so it stays cheap and is
// guaranteed to reach every post we track rather than hoping a fixed result count is deep
// enough.
//
// FIELD NAMES ARE DEFENSIVE ON PURPOSE. apify-scout-normalize-facebook.ts records the
// lesson from this repo's own live Facebook runs (2026-08-18): Facebook scrapes come back
// less consistently shaped than Instagram's, and one of three real test pages returned an
// empty dataset outright. Every field below therefore has fallbacks, and anything missing
// becomes null rather than 0 — a post whose share count didn't come back is not a post with
// zero shares.

type ActorItem = Record<string, unknown>;

function num(item: ActorItem, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    // Some Facebook fields arrive as numeric strings ("1,234" included).
    if (typeof v === "string") {
      const n = Number(v.replace(/,/g, ""));
      if (v.trim() !== "" && Number.isFinite(n)) return n;
    }
  }
  return null;
}

function str(item: ActorItem, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

/** Nested `user.name` / `user.id`, which the actor returns as an object. */
function nested(item: ActorItem, parent: string, key: string): string | null {
  const p = item[parent];
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const v = (p as ActorItem)[key];
  return typeof v === "string" && v.length > 0 ? v : typeof v === "number" ? String(v) : null;
}

const REACTION_FIELDS: Record<string, string> = {
  like: "reactionLikeCount",
  love: "reactionLoveCount",
  care: "reactionCareCount",
  haha: "reactionHahaCount",
  wow: "reactionWowCount",
  sad: "reactionSadCount",
  angry: "reactionAngryCount",
};

function reactions(item: ActorItem): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const [label, field] of Object.entries(REACTION_FIELDS)) {
    const v = num(item, field);
    if (v !== null) out[label] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Post ID as it appears in a post URL, so it can be matched against TrackedPost.postKey.
 *
 * The actor's `postId` is the canonical form, but the URL it echoes back is the fallback:
 * a pasted link may key on a `pfbid…` permalink token while the actor reports the numeric
 * ID, and vice versa. Both are returned so the caller can match on either — matching on one
 * alone silently drops posts whose link used the other form.
 */
export function facebookPostKeys(item: ActorItem): string[] {
  const keys: string[] = [];
  const id = str(item, "postId", "post_id") ?? (typeof item.postId === "number" ? String(item.postId) : null);
  if (id) keys.push(id);

  const url = str(item, "url", "postUrl", "facebookUrl", "topLevelUrl");
  if (url) {
    const pfbid = url.match(/\/posts\/(pfbid[A-Za-z0-9]+)/i);
    if (pfbid) keys.push(pfbid[1]);
    const numeric = url.match(/\/(?:posts|videos|reel)\/(\d+)/i);
    if (numeric) keys.push(numeric[1]);
    const fbid = url.match(/[?&](?:story_fbid|fbid|v)=(\d+)/i);
    if (fbid) keys.push(fbid[1]);
  }
  return [...new Set(keys)];
}

export interface NormalizedFacebookPost {
  /** Every ID form this post could be matched by — see facebookPostKeys. */
  postKeys: string[];
  pageName: string | null;
  pageId: string | null;
  mediaType: string;
  caption: string | null;
  postedAt: string | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  /** Video view count. Never called reach — see CAMPAIGN-POST-TRACKING.md §1. */
  views: number | null;
  reactions: Record<string, number> | null;
  raw: ActorItem;
}

function mediaTypeOf(item: ActorItem): string {
  if (num(item, "viewsCount", "videoViewCount", "videoPlayCount") !== null) return "video";
  const media = item.media;
  if (Array.isArray(media) && media.length > 1) return "carousel";
  return "image";
}

export function normalizeFacebookPostItem(item: ActorItem): NormalizedFacebookPost {
  // `likes` is the plain like count; `reactionLikeCount` and friends break it down. Summed
  // reactions are NOT substituted for `likes` when it is missing — the two count different
  // things, and inventing one from the other would put a derived figure in a column the UI
  // presents as measured.
  return {
    postKeys: facebookPostKeys(item),
    pageName: str(item, "pageName", "pageTitle") ?? nested(item, "user", "name"),
    pageId: str(item, "facebookId", "pageId") ?? nested(item, "user", "id"),
    mediaType: mediaTypeOf(item),
    caption: str(item, "text", "message", "postText"),
    postedAt: str(item, "time", "date", "publishedAt"),
    likes: num(item, "likes", "likesCount", "reactionLikeCount"),
    comments: num(item, "comments", "commentsCount"),
    // The one metric Instagram never gives us and Facebook does.
    shares: num(item, "shares", "sharesCount", "shareCount"),
    views: num(item, "viewsCount", "videoViewCount", "videoPlayCount"),
    reactions: reactions(item),
    raw: item,
  };
}
