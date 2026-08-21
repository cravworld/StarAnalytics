// Raw actor output -> canonical RawPost. One function per actor so each actor's
// field quirks are isolated and independently fixable when Instagram/Apify changes
// something. Nothing downstream of this file should ever see an actor-shaped object.
//
// Field names below were confirmed against live sample runs of all three actors
// (2026-07-15): apify/instagram-hashtag-scraper, apify/instagram-profile-scraper
// (followersCount, fullName, postsCount), and apify/instagram-post-scraper in both
// username-mode and post-URL-mode (shortCode, likesCount, commentsCount, timestamp,
// ownerUsername, type — same shape as the hashtag scraper). No item sampled included
// a reach/impressions-labeled field; a videoViewCount-style field only appears under
// the post scraper's paid "detailedData" tier (video play count). No RawPost path requests
// that tier — reach/saves stay null and are never backfilled from it. The one exception is
// normalizeTrackedPostItem below, which serves Campaign Post Tracking: it does request the
// paid tier and does read the play count, but stores it as `views`, never as reach. See
// CAMPAIGN-POST-TRACKING.md §1a.

import type { RawPost } from "./types";

type ActorItem = Record<string, unknown>;

function str(item: ActorItem, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function num(item: ActorItem, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === "number") return v;
  }
  return null;
}

function mediaType(item: ActorItem): RawPost["mediaType"] {
  const t = (str(item, "type", "productType") ?? "").toLowerCase();
  if (t.includes("video") || t.includes("reel") || t === "clips") return "reel";
  if (t.includes("sidecar") || t.includes("carousel")) return "carousel";
  if (t.includes("image") || t === "photo") return "image";
  return t || "image";
}

// DPDP data minimization (DATA-PRIVACY.md, "What raw scrape payload actually contains").
// The actor item is stored verbatim as an ingestion artifact, and the first real
// audit:raw-payload run (2026-08-20) found it carries a commenter's real name and
// profile photo URL at 100% presence — a materially larger data class than the
// "comment text + author handle" this app is documented as collecting. Nothing reads
// these fields. Dropped here at ingest rather than retained for
// RAW_PAYLOAD_RETENTION_DAYS and pruned later.
//
// Deliberately narrow, and the narrowness is the point. Only fields that BOTH identify a
// person AND have no code reference are removed; every derived metric stays, because
// `raw` exists precisely to be the artifact you go back to, and a field dropped here
// cannot be re-derived for anything scraped afterwards. `ownerUsername` also stays — it
// is the handle, it is already its own column, and removing it would break nothing but
// gain nothing.
//
// `hashtags` must survive: backfillCampaignLink() in apify-public-content.ts queries
// `raw -> 'hashtags'` in SQL. It is the one field here that is genuinely read back.
const RAW_DROPPED_TOP_LEVEL = ["ownerFullName", "ownerProfilePicUrl"];
const RAW_DROPPED_OWNER = ["full_name", "profile_pic_url", "profile_pic_id"];

function minimizeRaw(item: ActorItem): ActorItem {
  const out: ActorItem = { ...item };
  for (const key of RAW_DROPPED_TOP_LEVEL) delete out[key];

  // The comment actor nests the commenter under `owner`; strip inside it without
  // disturbing the rest of that object (id/username/is_verified and friends stay).
  const owner = out.owner;
  if (owner && typeof owner === "object" && !Array.isArray(owner)) {
    const cleaned: ActorItem = { ...(owner as ActorItem) };
    for (const key of RAW_DROPPED_OWNER) delete cleaned[key];
    out.owner = cleaned;
  }
  return out;
}

// videoViewCount/videoPlayCount are NOT true reach (a private Insights metric) — map
// them to null rather than let them masquerade as reach. See AGENTS.md Phase 1 §5.
function toRawPost(item: ActorItem, source: RawPost["source"]): RawPost {
  const shortcode = str(item, "shortCode", "shortcode") ?? "";
  const postedAt = str(item, "timestamp") ?? new Date().toISOString();
  return {
    id: shortcode || crypto.randomUUID(),
    source,
    platform: "instagram",
    igShortcode: shortcode,
    externalUrl: str(item, "url", "inputUrl") ?? "",
    authorHandle: str(item, "ownerUsername", "username") ?? "",
    mediaType: mediaType(item),
    caption: str(item, "caption") ?? "",
    postedAt,
    reach: null,
    likes: num(item, "likesCount") ?? 0,
    comments: num(item, "commentsCount") ?? 0,
    saves: null,
    shares: null,
    raw: minimizeRaw(item),
  };
}

export function normalizeHashtagItem(item: ActorItem): RawPost {
  return toRawPost(item, "campaign");
}

export function normalizeProfilePostItem(item: ActorItem, source: RawPost["source"] = "competitor"): RawPost {
  return toRawPost(item, source);
}

export function normalizePostUrlItem(item: ActorItem, source: RawPost["source"] = "agency"): RawPost {
  return toRawPost(item, source);
}

// ---------------------------------------------------------------------------
// Campaign Post Tracking — apify/instagram-post-scraper, PAID detail tier
// ---------------------------------------------------------------------------

/**
 * Shape returned for a tracked campaign post. Deliberately NOT a `RawPost`: RawPost is the
 * shape of the `posts` table, and a tracked post is a different table with a different
 * lifecycle (see CAMPAIGN-POST-TRACKING.md §2a). Reusing RawPost here would drag along
 * `source`, `reach` and `saves`, none of which mean anything for this feature.
 */
export interface NormalizedTrackedPost {
  postKey: string;
  authorHandle: string | null;
  mediaType: string;
  caption: string | null;
  postedAt: string | null;
  likes: number | null;
  comments: number | null;
  /**
   * Instagram play count, from the actor's PAID detailedData tier — reels and videos only.
   *
   * `toRawPost` above maps this same field to null on purpose, and that stays correct for
   * every other call path: nothing else in the app consumes it, and it must never reach a
   * column named `reach`. This feature is the one consumer, so it reads the field here and
   * stores it as `views` — a count of video starts, not of distinct people. See
   * CAMPAIGN-POST-TRACKING.md §1a for why the surcharge is accepted on this path alone.
   *
   * Null for photos and carousels: they have no play count, which is not a zero-view post.
   */
  views: number | null;
  raw: ActorItem;
}

export function normalizeTrackedPostItem(item: ActorItem): NormalizedTrackedPost {
  const shortcode = str(item, "shortCode", "shortcode") ?? "";
  return {
    postKey: shortcode,
    authorHandle: str(item, "ownerUsername", "username"),
    mediaType: mediaType(item),
    caption: str(item, "caption"),
    postedAt: str(item, "timestamp"),
    likes: num(item, "likesCount"),
    comments: num(item, "commentsCount"),
    views: num(item, "videoPlayCount", "videoViewCount"),
    // Minimized exactly like toRawPost's. This path scrapes the same actor and stores the
    // same item shape, so skipping it would quietly reintroduce the identifying fields
    // (ownerFullName, ownerProfilePicUrl) that the 2026-08-20 data-minimization pass
    // removed — on a brand-new table the audit script does not yet cover.
    raw: minimizeRaw(item),
  };
}

// apify/instagram-comment-scraper — field names confirmed against a live 2-URL sample run
// (2026-07-16, resultsLimit 2, includeNestedComments false). The actor's own README sample
// JSON omits the per-comment post-correlation field entirely (a real gap, not an oversight
// on our part) — the real dataset item carries `postUrl` (echoes the input directUrls entry
// verbatim), which is what lets one batched run's mixed-order results be attributed back to
// the right post. `owner` duplicates `ownerUsername`/`ownerProfilePicUrl` as a nested object;
// the top-level fields are used here, `owner` is preserved only via `raw`.
export interface NormalizedComment {
  postId: string;
  igCommentId: string | null;
  authorHandle: string | null;
  text: string;
  postedAt: string | null;
  raw: Record<string, unknown>;
}

/**
 * Attribution key for an Instagram post URL, resilient to URL-shape differences.
 *
 * A batched comment run is attributed back to posts by matching the item's `postUrl`
 * against the URLs we sent in. "Echoes the input" is not a guarantee of byte-equality:
 * a trailing slash, `/reels/` vs `/reel/`, a stripped `?igsh=` tracking parameter, or
 * `www.` appearing or disappearing would all miss on a raw string lookup — and a miss
 * drops that item silently, so the run is paid for in full and stores nothing. The
 * shortcode is the one part of the URL that cannot vary.
 *
 * Falls back to a normalized whole-URL comparison for anything that isn't a recognisable
 * post/reel URL, so a non-Instagram or unexpected shape still matches itself.
 */
export function postUrlKey(url: string): string {
  const shortcode = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  return shortcode ? shortcode[1] : url.trim().replace(/\/+$/, "").toLowerCase();
}

export function normalizeCommentItem(item: ActorItem, postId: string): NormalizedComment {
  return {
    postId,
    igCommentId: str(item, "id"),
    authorHandle: str(item, "ownerUsername"),
    text: str(item, "text") ?? "",
    postedAt: str(item, "timestamp"),
    raw: minimizeRaw(item),
  };
}

export interface ProfileSnapshotFields {
  followers: number;
  displayName: string;
  postsCount: number | null;
}

export function normalizeProfileItem(item: ActorItem): ProfileSnapshotFields {
  return {
    followers: num(item, "followersCount", "followers") ?? 0,
    displayName: str(item, "fullName", "full_name") ?? "",
    postsCount: num(item, "postsCount", "posts_count"),
  };
}
