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
// the post scraper's paid "detailedData" tier (video play count), which this
// integration does not request — reach/saves stay null, never backfilled from it.

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
    raw: item,
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

export function normalizeCommentItem(item: ActorItem, postId: string): NormalizedComment {
  return {
    postId,
    igCommentId: str(item, "id"),
    authorHandle: str(item, "ownerUsername"),
    text: str(item, "text") ?? "",
    postedAt: str(item, "timestamp"),
    raw: item,
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
