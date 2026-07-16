import type { AccountSnapshot, PublicContentProvider, RawPost } from "./types";
import { AGENCIES, POSTS, TRACKED_HASHTAGS, VIJAYAM_DETAIL } from "./seed";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// "18.4K" / "920" -> 18400 / 920. Lets the mock reuse POSTS' real clean-vs-
// flagged like:comment spread (seed.ts: clean agencies ~20:1, flagged ones
// 250-325:1) instead of returning all-zero engagement regardless of input —
// which used to make dev-mode "sane relative rankings" checks meaningless
// without live Apify credentials.
function parseCompactNumber(s: string): number {
  const cleaned = s.replace(/,/g, "");
  if (cleaned.endsWith("K")) return Math.round(parseFloat(cleaned) * 1_000);
  if (cleaned.endsWith("M")) return Math.round(parseFloat(cleaned) * 1_000_000);
  return Math.round(parseFloat(cleaned)) || 0;
}

const ENGAGEMENT_PATTERNS = POSTS.map((p) => ({
  likes: parseCompactNumber(p.likes),
  comments: parseCompactNumber(p.comments),
}));

const SHORTCODE_RE = /instagram\.com\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/i;

function toRawPost(url: string, i: number): RawPost {
  const pattern = ENGAGEMENT_PATTERNS[i % ENGAGEMENT_PATTERNS.length];
  const shortcode = url.match(SHORTCODE_RE)?.[1] ?? `mock-${i}`;
  return {
    id: `agency-post-${i}`,
    source: "agency",
    igShortcode: shortcode,
    externalUrl: url,
    authorHandle: "",
    mediaType: "photo",
    caption: "",
    postedAt: new Date().toISOString(),
    reach: null,
    likes: pattern.likes,
    comments: pattern.comments,
    saves: null,
    shares: null,
    raw: { mockPattern: pattern },
  };
}

export class MockPublicContentProvider implements PublicContentProvider {
  async scrapeByHashtag(tag: string): Promise<RawPost[]> {
    await delay(120);
    const known = TRACKED_HASHTAGS.find((h) => h.name.toLowerCase() === tag.toLowerCase());
    if (!known) return [];
    return VIJAYAM_DETAIL.stream.map((s, i) => ({
      id: `htag-${tag}-${i}`,
      source: "campaign",
      igShortcode: `${tag}-${i}`,
      externalUrl: "",
      authorHandle: s.handle,
      mediaType: "post",
      caption: s.text,
      postedAt: s.time,
      reach: null,
      likes: Number(s.likes.replace("K", "")) * 1000,
      comments: Number(s.comments),
      saves: null,
      shares: null,
      raw: { ...s },
    }));
  }

  async scrapeByHandle(handle: string): Promise<AccountSnapshot & { posts: RawPost[] }> {
    await delay(120);
    return {
      handle,
      displayName: handle.replace("@", ""),
      followers: 9_100_000,
      avgLikesPerPost: 588_000,
      postsPerWeek: 4.0,
      reelAvgViews: 3_400_000,
      engagementRateEstimate: 3.7,
      storyResponseRate: null,
      posts: [],
    };
  }

  async scrapeByUrls(urls: string[]): Promise<RawPost[]> {
    await delay(150);
    return urls.map((url, i) => toRawPost(url, i));
  }
}

export const MOCK_AGENCIES = AGENCIES;
