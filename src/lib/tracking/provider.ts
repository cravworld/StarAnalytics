// Provider seam for Campaign Post Tracking. Screens and the data layer depend only on the
// interfaces here — never on Apify or the YouTube API directly — same discipline as
// providers/types.ts.
//
// Split from providers/index.ts on purpose: that file's PublicContentProvider is welded to
// the `PlatformId` union (instagram|youtube) and to the `posts` table's RawPost shape.
// This feature needs a third platform and a different storage target, so it gets its own
// seam rather than widening one that ~79 call sites narrow on.

import {
  fetchTrackedInstagramPosts,
  fetchTrackedFacebookPosts,
  fetchFacebookPageSnapshot,
  fetchProfileSnapshot,
} from "@/lib/providers/apify-public-content";
import {
  fetchTrackedYouTubeVideos,
  fetchYouTubeChannelById,
} from "@/lib/providers/youtube-public-content";
import { facebookPageFrom, type TrackPlatformId } from "./postUrl";

/** Current metrics for one tracked post. Every metric nullable — see insights.ts. */
export interface TrackedPostScrape {
  postKey: string;
  /** Stable account identifier: IG username, FB page slug, YouTube channel ID. */
  authorHandle: string | null;
  authorDisplayName: string | null;
  mediaType: string | null;
  caption: string | null;
  postedAt: string | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  views: number | null;
  reactions: Record<string, number> | null;
  raw: Record<string, unknown>;
}

export interface TrackedAccountScrape {
  handle: string;
  displayName: string | null;
  followers: number | null;
  /**
   * False when the platform declined to report a follower count — a private Instagram
   * profile, a YouTube channel hiding its subscriber count. Distinct from followers === 0,
   * which would be a real (if unlikely) measurement. Every engagement rate is computed
   * against this denominator, so conflating "hidden" with "zero" would silently produce
   * either a division by zero or a wildly inflated rate.
   */
  followersAvailable: boolean;
  raw: Record<string, unknown> | null;
}

export interface TrackedPostProvider {
  /**
   * Batch-fetch current metrics. `url` drives Instagram and Facebook, `postKey` YouTube.
   *
   * `postedAt` is optional and only Facebook reads it: it bounds that page's scrape to the
   * oldest post being tracked there. Absent on a first ingest (we don't know the date until
   * we've scraped it), present on every refresh.
   */
  scrapePosts(
    platform: TrackPlatformId,
    posts: { postKey: string; url: string; postedAt?: string | null }[],
  ): Promise<TrackedPostScrape[]>;

  scrapeAccount(platform: TrackPlatformId, handle: string): Promise<TrackedAccountScrape>;
}

/**
 * Thrown when a platform has no scraping path at all.
 *
 * All three of instagram/facebook/youtube are implemented, so this is now only reachable
 * if TrackPlatform gains a fourth variant without a matching provider branch — which is
 * exactly when it should be loud. Kept deliberately: an unhandled platform must throw
 * rather than return an empty result, because a tracked post silently reporting zero
 * engagement is indistinguishable from a real zero and would drag every campaign total
 * down with it.
 */
export class PlatformNotSupportedError extends Error {
  constructor(platform: TrackPlatformId) {
    super(`${platform} has no tracking provider — no scraper is wired up for it.`);
    this.name = "PlatformNotSupportedError";
  }
}

class LiveTrackedPostProvider implements TrackedPostProvider {
  async scrapePosts(
    platform: TrackPlatformId,
    posts: { postKey: string; url: string; postedAt?: string | null }[],
  ): Promise<TrackedPostScrape[]> {
    if (posts.length === 0) return [];

    if (platform === "instagram") {
      const items = await fetchTrackedInstagramPosts(posts.map((p) => p.url));
      return items.map((i) => ({
        postKey: i.postKey,
        authorHandle: i.authorHandle,
        authorDisplayName: null,
        mediaType: i.mediaType,
        caption: i.caption,
        postedAt: i.postedAt,
        likes: i.likes,
        comments: i.comments,
        // Instagram exposes neither publicly, at any actor tier. Null, never 0.
        shares: null,
        reactions: null,
        views: i.views,
        raw: i.raw,
      }));
    }

    if (platform === "facebook") {
      return this.scrapeFacebook(posts);
    }

    if (platform === "youtube") {
      const videos = await fetchTrackedYouTubeVideos(posts.map((p) => p.postKey));
      return videos.map((v) => ({
        postKey: v.postKey,
        // The channel ID, not the title: titles are mutable and non-unique, and this value
        // becomes the account's dedup key.
        authorHandle: v.channelId,
        authorDisplayName: v.channelTitle,
        mediaType: v.mediaType,
        caption: v.caption,
        postedAt: v.postedAt,
        likes: v.likes,
        comments: v.comments,
        shares: null,
        reactions: null,
        views: v.views,
        raw: v.raw,
      }));
    }

    throw new PlatformNotSupportedError(platform);
  }

  /**
   * Facebook: group the tracked posts by the page they belong to, scrape each page once,
   * and match our posts out of the results.
   *
   * One run per PAGE, not per post — three posts from the same influencer is one scrape.
   * The date bound comes from the oldest post we track on that page, so the run is
   * guaranteed to reach all of them.
   *
   * A post whose page cannot be derived from its URL (`/reel/{id}`, `/watch/?v={id}`,
   * `/share/p/{hash}` name a post and nothing else) is skipped rather than guessed at. The
   * caller reports it as not-found, which is honest: we genuinely cannot tell which page to
   * ask.
   */
  private async scrapeFacebook(
    posts: { postKey: string; url: string; postedAt?: string | null }[],
  ): Promise<TrackedPostScrape[]> {
    const byPage = new Map<string, typeof posts>();
    for (const p of posts) {
      const page = facebookPageFrom(p.url);
      if (!page) continue;
      const list = byPage.get(page) ?? [];
      list.push(p);
      byPage.set(page, list);
    }

    const out: TrackedPostScrape[] = [];
    for (const [page, pagePosts] of byPage) {
      const dates = pagePosts
        .map((p) => (p.postedAt ? new Date(p.postedAt) : null))
        .filter((d): d is Date => d !== null && !Number.isNaN(d.getTime()));
      const oldest = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;

      const scraped = await fetchTrackedFacebookPosts(`https://www.facebook.com/${page}/`, oldest);

      // Index every ID form each returned post could be matched by — a pasted link may use
      // a pfbid permalink while the actor reports the numeric id, or the reverse. Matching
      // on one form alone silently drops the other.
      const byKey = new Map<string, (typeof scraped)[number]>();
      for (const s of scraped) for (const k of s.postKeys) byKey.set(k, s);

      for (const p of pagePosts) {
        const match = byKey.get(p.postKey);
        if (!match) continue; // caller reports not-found; never a fabricated zero
        out.push({
          postKey: p.postKey,
          authorHandle: page,
          authorDisplayName: match.pageName,
          mediaType: match.mediaType,
          caption: match.caption,
          postedAt: match.postedAt,
          likes: match.likes,
          comments: match.comments,
          shares: match.shares,
          reactions: match.reactions,
          views: match.views,
          raw: match.raw,
        });
      }
    }
    return out;
  }

  async scrapeAccount(platform: TrackPlatformId, handle: string): Promise<TrackedAccountScrape> {
    if (platform === "facebook") {
      const page = await fetchFacebookPageSnapshot(`https://www.facebook.com/${handle}/`);
      return {
        handle,
        displayName: page.displayName,
        followers: page.followers,
        followersAvailable: page.followers !== null,
        raw: page.raw,
      };
    }

    if (platform === "instagram") {
      // Reuses the existing profile call, which already keeps `includeAboutSection: false`
      // — APIFY-USAGE-AUDIT.md finding L: that add-on bills $0.006/profile, more than the
      // profile call itself, and nothing reads what it returns. The §1a detail-tier
      // exception is scoped to post scrapes only and must not drift into this path.
      const snap = await fetchProfileSnapshot(handle);
      return {
        handle: snap.handle,
        displayName: snap.displayName,
        followers: snap.followers,
        // fetchProfileSnapshot substitutes 0 when the actor returned no profile item at
        // all (private/deleted/renamed). Treated as unknown rather than as an audience of
        // zero, so no engagement rate is computed against it.
        followersAvailable: snap.followers > 0,
        raw: null,
      };
    }

    if (platform === "youtube") {
      const channel = await fetchYouTubeChannelById(handle);
      if (!channel) {
        return { handle, displayName: null, followers: null, followersAvailable: false, raw: null };
      }
      return {
        handle,
        displayName: channel.title,
        followers: channel.subscribers,
        followersAvailable: channel.subscribers !== null,
        raw: channel.raw,
      };
    }

    throw new PlatformNotSupportedError(platform);
  }
}

/**
 * Deterministic stand-in for local work and tests. Never touches the network.
 *
 * Numbers are derived from the post key rather than random so a given link always produces
 * the same figures — a re-scan in mock mode shows a stable value instead of fake movement,
 * and tests can assert on real numbers.
 *
 * Facebook throws here too. Mock mode must not be the one place where Facebook appears to
 * work, or the gap gets discovered in production instead of locally.
 */
class MockTrackedPostProvider implements TrackedPostProvider {
  private hash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }

  async scrapePosts(
    platform: TrackPlatformId,
    posts: { postKey: string; url: string; postedAt?: string | null }[],
  ): Promise<TrackedPostScrape[]> {
    return posts.flatMap((p) => {
      const h = this.hash(p.postKey);
      const isVideo = h % 3 !== 0;

      // Facebook posts whose URL doesn't name a page cannot be scraped at all — the live
      // path skips them and the caller reports not-found. Mirrored here so that branch is
      // exercised locally rather than discovered in production.
      if (platform === "facebook" && !facebookPageFrom(p.url)) return [];

      return [
        {
          postKey: p.postKey,
          authorHandle:
            platform === "youtube"
              ? `UC${(h % 1000).toString().padStart(3, "0")}mock`
              : platform === "facebook"
                ? (facebookPageFrom(p.url) ?? `mock.page.${h % 5}`)
                : `mock_creator_${h % 5}`,
          authorDisplayName: `Mock Creator ${h % 5}`,
          mediaType:
            platform === "youtube"
              ? isVideo
                ? "video"
                : "short"
              : isVideo
                ? platform === "facebook"
                  ? "video"
                  : "reel"
                : "image",
          caption: `Mock tracked post ${p.postKey}`,
          postedAt: new Date(Date.UTC(2026, 7, 1 + (h % 20))).toISOString(),
          likes: 500 + (h % 4500),
          comments: 10 + (h % 300),
          // Shares are Facebook-only in reality; the mock must not invent them elsewhere,
          // or the "null is not zero" behaviour looks wrong in local work.
          shares: platform === "facebook" ? 5 + (h % 200) : null,
          reactions:
            platform === "facebook"
              ? { like: 400 + (h % 3000), love: h % 400, haha: h % 90 }
              : null,
          // Only video-ish posts get a play count, matching the real constraint that photos
          // and carousels have none.
          views: isVideo ? 10_000 + (h % 90_000) : null,
          raw: { mock: true, postKey: p.postKey },
        },
      ];
    });
  }

  async scrapeAccount(platform: TrackPlatformId, handle: string): Promise<TrackedAccountScrape> {
    const h = this.hash(handle);
    // One in seven mock accounts hides its follower count, so the "no engagement rate
    // available" path is exercised in local work rather than only in production.
    const hidden = h % 7 === 0;
    return {
      handle,
      displayName: `Mock Creator ${h % 5}`,
      followers: hidden ? null : 5_000 + (h % 495_000),
      followersAvailable: !hidden,
      raw: { mock: true },
    };
  }
}

/**
 * Instagram rides on DATA_MODE_APIFY and YouTube on DATA_MODE_YOUTUBE, so a single switch
 * here would be wrong — the two sources flip to live independently, exactly as
 * providers/index.ts already models them. Live is used only when the platform's own mode
 * says so; anything else falls back to the mock.
 */
export function getTrackedPostProvider(platform: TrackPlatformId): TrackedPostProvider {
  const envVar = platform === "youtube" ? "DATA_MODE_YOUTUBE" : "DATA_MODE_APIFY";
  return process.env[envVar] === "live" ? new LiveTrackedPostProvider() : new MockTrackedPostProvider();
}

/** True when this platform can be tracked at all. Facebook is false until §4a is settled. */
export function isTrackablePlatform(platform: TrackPlatformId): boolean {
  return platform === "instagram" || platform === "youtube";
}
