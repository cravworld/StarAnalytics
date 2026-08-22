// Pasted post link -> { platform, postKey }. The single entry point for turning whatever a
// human copied out of a share sheet into something storable.
//
// Two thirds of this already existed but were private to their callers: `extractShortcode`
// in data/agency.ts (Instagram) and `parseVideoId` in providers/youtube-public-content.ts
// (YouTube). Both are re-derived here rather than imported, because those two live inside
// modules that pull in Prisma and the YouTube API client respectively — this file has to
// stay dependency-free so it can be unit-tested and used from client components for
// pre-submit validation.
//
// The `postKey` is the platform's own stable ID, never the URL: the same post has many URL
// spellings (/p/ vs /reel/, trailing slash, ?igsh= tracking params, m. vs www) and storing
// the raw URL as a dedup key would let the same post be tracked several times over. Same
// discipline as apify-normalize.ts's postUrlKey.

export type TrackPlatformId = "instagram" | "facebook" | "youtube";

export interface ParsedPostUrl {
  platform: TrackPlatformId;
  postKey: string;
  /** The URL with tracking params and mobile-host variance stripped. Stored for display. */
  canonicalUrl: string;
}

export type ParsePostUrlResult =
  | { ok: true; value: ParsedPostUrl }
  | { ok: false; reason: string };

/**
 * Facebook share-sheet links (facebook.com/share/p/{hash}) carry no post ID — the hash is
 * opaque and only resolves by following an HTTP redirect. This is the form the mobile app
 * produces, so it is the one people paste most often; it gets its own error message rather
 * than falling through to "unrecognised link", which would be true but useless.
 */
export const FB_SHARE_LINK_REASON =
  "Facebook share links (facebook.com/share/...) don't contain the post ID. Open the post on facebook.com and copy the address bar URL instead.";

function stripTracking(raw: string): string {
  try {
    const u = new URL(raw);
    // Instagram's ?igsh=/?igshid=, Facebook's ?mibextid=, and the usual utm_* set are all
    // per-share values: two people sharing the same post produce different URLs.
    for (const key of [...u.searchParams.keys()]) {
      if (/^(igsh|igshid|mibextid|fbclid|si|utm_[a-z_]+)$/i.test(key)) u.searchParams.delete(key);
    }
    u.hash = "";
    return u.toString();
  } catch {
    return raw.trim();
  }
}

function hostOf(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^(www|m|mobile|web)\./, "");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Instagram
// ---------------------------------------------------------------------------

// /p/ (any post), /reel/ and /reels/ (video), /tv/ (legacy IGTV). All four resolve to the
// same shortcode space, so all four are accepted and normalized to the same key.
const IG_POST = /instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i;

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------

const YT_PATTERNS: RegExp[] = [
  /[?&]v=([A-Za-z0-9_-]{6,})/, // watch?v=
  /youtu\.be\/([A-Za-z0-9_-]{6,})/i, // short link
  /youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/i, // Shorts
  /youtube\.com\/live\/([A-Za-z0-9_-]{6,})/i, // premieres / live replays
  /youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/i, // embed
];

// ---------------------------------------------------------------------------
// Facebook
// ---------------------------------------------------------------------------

const FB_PATTERNS: RegExp[] = [
  /facebook\.com\/[^/]+\/posts\/(?:pfbid[A-Za-z0-9]+|(\d+))/i,
  /facebook\.com\/[^/]+\/videos\/(\d+)/i,
  /facebook\.com\/reel\/(\d+)/i,
  /facebook\.com\/watch\/?\?v=(\d+)/i,
  /facebook\.com\/permalink\.php\?[^#]*story_fbid=(\d+)/i,
  /facebook\.com\/photo(?:\.php)?\/?\?[^#]*fbid=(\d+)/i,
];

// A /posts/pfbid... permalink is the modern opaque form. It IS stable and IS resolvable by
// the actors (unlike /share/p/), so it is captured whole rather than rejected.
const FB_PFBID = /facebook\.com\/[^/]+\/posts\/(pfbid[A-Za-z0-9]+)/i;

// Path segments that are Facebook's own routes, never a page slug. Without this,
// "facebook.com/reel/123" would yield a page called "reel".
const FB_RESERVED = new Set([
  "reel",
  "reels",
  "watch",
  "share",
  "photo",
  "photo.php",
  "permalink.php",
  "story.php",
  "profile.php",
  "pages",
  "groups",
  "events",
  "marketplace",
  "video.php",
  "media",
]);

/**
 * The page a Facebook post belongs to, derived from the post URL itself.
 *
 * This exists because Apify has no official actor that takes a Facebook post URL and
 * returns that post's metrics — the whole official Facebook lineup is organised by
 * container (page, group, event), not by post. So the only route to a post's numbers is to
 * scrape its page and match the post out of the results, which means deriving the page from
 * the link the operator pasted.
 *
 * Returns null when the URL genuinely doesn't name its page — `/reel/{id}`,
 * `/watch/?v={id}` and `/share/p/{hash}` carry a post ID and nothing else. Those need the
 * page supplied separately; callers must say so rather than guessing.
 */
export function facebookPageFrom(url: string): string | null {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    return null;
  }

  // permalink.php?story_fbid=<post>&id=<page> — the page is the numeric `id` param.
  const pageId = u.searchParams.get("id");
  if (/^\d+$/.test(pageId ?? "")) return pageId;

  const first = u.pathname.split("/").filter(Boolean)[0];
  if (!first) return null;
  if (FB_RESERVED.has(first.toLowerCase())) return null;
  // A bare numeric first segment is a page ID, which is fine; a slug is fine too.
  return first;
}

export function parsePostUrl(input: string): ParsePostUrlResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, reason: "Empty link." };

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const host = hostOf(withScheme);
  if (!host) return { ok: false, reason: `"${trimmed}" is not a valid URL.` };

  const canonicalUrl = stripTracking(withScheme);

  if (host === "instagram.com" || host.endsWith(".instagram.com")) {
    const m = canonicalUrl.match(IG_POST);
    if (m) return { ok: true, value: { platform: "instagram", postKey: m[1], canonicalUrl } };
    return {
      ok: false,
      reason:
        "That looks like an Instagram profile or story, not a post. Tracking needs a permanent post link (/p/, /reel/ or /tv/). Stories expire after 24 hours and cannot be tracked.",
    };
  }

  if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be") {
    for (const re of YT_PATTERNS) {
      const m = canonicalUrl.match(re);
      if (m) return { ok: true, value: { platform: "youtube", postKey: m[1], canonicalUrl } };
    }
    return { ok: false, reason: "That YouTube link has no video ID in it." };
  }

  if (host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.watch") {
    if (/facebook\.com\/share\//i.test(canonicalUrl)) {
      return { ok: false, reason: FB_SHARE_LINK_REASON };
    }
    const pfbid = canonicalUrl.match(FB_PFBID);
    if (pfbid) return { ok: true, value: { platform: "facebook", postKey: pfbid[1], canonicalUrl } };
    for (const re of FB_PATTERNS) {
      const m = canonicalUrl.match(re);
      if (m && m[1]) return { ok: true, value: { platform: "facebook", postKey: m[1], canonicalUrl } };
    }
    return { ok: false, reason: "That Facebook link has no post ID in it." };
  }

  return {
    ok: false,
    reason: `${host} isn't a supported platform. Tracking covers Instagram, Facebook and YouTube.`,
  };
}

export interface ParsedAccountUrl {
  platform: TrackPlatformId;
  /** Instagram username / Facebook page slug or id / YouTube channel id or @handle. */
  handle: string;
  canonicalUrl: string;
}

export type ParseAccountUrlResult =
  | { ok: true; value: ParsedAccountUrl }
  | { ok: false; reason: string };

// Instagram path segments that are app routes, never a username.
const IG_RESERVED = new Set([
  "p",
  "reel",
  "reels",
  "tv",
  "stories",
  "explore",
  "accounts",
  "direct",
  "s",
]);

// YouTube gives a channel three URL shapes and they are NOT equivalent to us.
//   /@handle       -> resolvable via channels.list?forHandle
//   /channel/UC... -> the channel id itself, resolvable via channels.list?id
//   /c/customName  -> a legacy vanity name, resolvable by NEITHER lookup. It needs a
//                     search call, which is 100 quota units against a 10,000/day budget
//                     (youtube-public-content.ts's own note) — so it is rejected with an
//                     instruction rather than silently costing a hundred times a normal
//                     lookup or failing opaquely.
const YT_HANDLE = /youtube\.com\/@([A-Za-z0-9_.-]+)/i;
const YT_CHANNEL_ID = /youtube\.com\/channel\/(UC[A-Za-z0-9_-]{20,})/i;
const YT_LEGACY_VANITY = /youtube\.com\/(?:c|user)\/([A-Za-z0-9_.-]+)/i;

/**
 * A page/profile link, as opposed to a single post.
 *
 * Companion to parsePostUrl: ingest tries the post parse first and falls back to this, so
 * the operator pastes whatever they have into one box and never has to declare which kind
 * of link it is.
 */
export function parseAccountUrl(input: string): ParseAccountUrlResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, reason: "Empty link." };

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const host = hostOf(withScheme);
  if (!host) return { ok: false, reason: `"${trimmed}" is not a valid URL.` };
  const canonicalUrl = stripTracking(withScheme);

  if (host === "instagram.com" || host.endsWith(".instagram.com")) {
    const seg = new URL(canonicalUrl).pathname.split("/").filter(Boolean)[0];
    if (!seg) return { ok: false, reason: "That's the Instagram home page, not an account." };
    if (IG_RESERVED.has(seg.toLowerCase())) {
      return { ok: false, reason: "That looks like a post link, not an account page." };
    }
    return { ok: true, value: { platform: "instagram", handle: seg, canonicalUrl } };
  }

  if (host === "youtube.com" || host.endsWith(".youtube.com")) {
    const byId = canonicalUrl.match(YT_CHANNEL_ID);
    if (byId) return { ok: true, value: { platform: "youtube", handle: byId[1], canonicalUrl } };
    const byHandle = canonicalUrl.match(YT_HANDLE);
    if (byHandle) return { ok: true, value: { platform: "youtube", handle: `@${byHandle[1]}`, canonicalUrl } };
    if (YT_LEGACY_VANITY.test(canonicalUrl)) {
      return {
        ok: false,
        reason:
          "That's a legacy YouTube /c/ or /user/ link, which the API can't resolve directly. Open the channel and copy its /@handle URL instead.",
      };
    }
    return { ok: false, reason: "That YouTube link doesn't point at a channel." };
  }

  if (host === "facebook.com" || host.endsWith(".facebook.com")) {
    // profile.php?id=<numeric> is the id-based form of a page URL.
    const numericId = new URL(canonicalUrl).searchParams.get("id");
    if (/^\d+$/.test(numericId ?? "")) {
      return { ok: true, value: { platform: "facebook", handle: numericId as string, canonicalUrl } };
    }
    const seg = new URL(canonicalUrl).pathname.split("/").filter(Boolean)[0];
    if (!seg) return { ok: false, reason: "That's the Facebook home page, not a page." };
    if (FB_RESERVED.has(seg.toLowerCase())) {
      return { ok: false, reason: "That looks like a post link, not a page." };
    }
    return { ok: true, value: { platform: "facebook", handle: seg, canonicalUrl } };
  }

  return {
    ok: false,
    reason: `${host} isn't a supported platform. Tracking covers Instagram, Facebook and YouTube.`,
  };
}

/**
 * Rebuild a post's public URL from its stored key.
 *
 * Needed because a page-discovered post has no pasted URL to keep — it arrived as an item
 * in a page scrape, not as a link someone typed. The URL is what the card links to and what
 * a later Facebook re-scan derives its page from, so it has to be reconstructible rather
 * than left null.
 */
export function postUrlFor(platform: TrackPlatformId, postKey: string, accountHandle: string): string {
  if (platform === "instagram") return `https://www.instagram.com/p/${postKey}/`;
  if (platform === "youtube") return `https://www.youtube.com/watch?v=${postKey}`;
  // Must keep the page in the path: facebookPageFrom() reads it back out to know which page
  // to scrape on refresh, and a bare /posts/{id} URL would strand the post permanently.
  return `https://www.facebook.com/${accountHandle}/posts/${postKey}`;
}

/** The public page URL for an account, used as scraper input. */
export function accountUrlFor(platform: TrackPlatformId, handle: string): string {
  if (platform === "instagram") return `https://www.instagram.com/${handle}/`;
  if (platform === "facebook") return `https://www.facebook.com/${handle}/`;
  return handle.startsWith("@")
    ? `https://www.youtube.com/${handle}`
    : `https://www.youtube.com/channel/${handle}`;
}

/**
 * Platform-prefixed dedup key for an account. A bare handle is not unique once three
 * platforms are in play.
 *
 * The normalization deliberately matches Scoutline's `profileUrlKey` (trim, lowercase,
 * strip trailing dots) so the two key spaces line up, plus a leading-`@` strip that
 * Scoutline doesn't need — its input is always a URL or a bare handle, while a scraped
 * `ownerUsername` can carry one.
 *
 * NOTE: this is NOT used to look up Scoutline candidates. That lookup calls Scoutline's own
 * profileUrlKey directly (see findScoutCandidateId), so the two can never drift into a
 * silent no-match. This function keys OUR table only.
 */
export function accountKeyFor(platform: TrackPlatformId, handle: string): string {
  const normalized = handle.trim().toLowerCase().replace(/^@/, "").replace(/\.+$/, "");
  return `${platform}:${normalized}`;
}

/**
 * A pasted blob -> the individual links in it.
 *
 * Lives here rather than in the Server Action because the form has to chunk the paste before
 * it submits (see TRACK_SUBMIT_CHUNK_SIZE), and a chunk boundary drawn with a different
 * splitter than the server's would cut a URL in half. One splitter, both sides.
 *
 * Splitting on whitespace AND commas means a column pasted straight out of a sheet works
 * as-is, which is how these lists actually arrive.
 */
export function splitTrackedPostUrls(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter(Boolean);
}

/**
 * How many links go in one submission. One.
 *
 * Not a cost-saving measure — it is the only thing that keeps a paste inside the request
 * budget. Every link whose author is new to the tracker costs an inline Apify profile scrape
 * in storeTrackedPost -> refreshAccountSnapshotIfStale, and a single Instagram profile can
 * take most of the page's 800s on its own. Two such links in one request is already over.
 *
 * The post-metrics scrape is genuinely batched (SCRAPE_BATCH_SIZE = 200, one actor run per
 * platform), which is what the old "one submission is at most one actor run" reasoning was
 * looking at when it let the whole textarea go in a single call. The per-account run is the
 * one that multiplies, and it is invisible from the URL list.
 *
 * Same value and same reason as BULK_ADD_CHUNK_SIZE.instagram on the fan-pages path. Kept
 * flat across platforms rather than per-platform like that one, because a single paste here
 * mixes platforms freely and there is no chunk to attach a per-platform size to.
 */
export const TRACK_SUBMIT_CHUNK_SIZE = 1;
