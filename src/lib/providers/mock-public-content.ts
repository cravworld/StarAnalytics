import type { AccountSnapshot, PublicContentProvider, RawPost } from "./types";
import { AGENCIES, POSTS, TRACKED_HASHTAGS, VIJAYAM_DETAIL } from "./seed";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function toRawPost(p: (typeof POSTS)[number], i: number): RawPost {
  return {
    id: `agency-post-${i}`,
    source: "agency",
    igShortcode: p.url,
    externalUrl: `https://${p.url}`,
    authorHandle: p.ag,
    mediaType: "photo",
    caption: "",
    postedAt: new Date().toISOString(),
    reach: null,
    likes: 0,
    comments: 0,
    saves: null,
    shares: null,
    raw: { ...p },
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
    void urls;
    return POSTS.map(toRawPost);
  }
}

export const MOCK_AGENCIES = AGENCIES;
