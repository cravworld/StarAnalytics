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
