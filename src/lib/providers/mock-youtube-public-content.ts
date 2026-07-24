import type { AccountSnapshot, PublicContentProvider, RawPost } from "./types";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function toRawPost(id: string, i: number): RawPost {
  return {
    id,
    source: "competitor",
    platform: "youtube",
    igShortcode: id,
    externalUrl: `https://www.youtube.com/watch?v=${id}`,
    authorHandle: "",
    mediaType: i % 3 === 0 ? "short" : "video",
    caption: `Mock YouTube video ${i}`,
    postedAt: new Date(Date.now() - i * 86_400_000).toISOString(),
    reach: 120_000 - i * 4_000,
    likes: 8_400 - i * 200,
    comments: 310 - i * 10,
    saves: null,
    shares: null,
    raw: { mock: true },
  };
}

export class MockYouTubePublicContentProvider implements PublicContentProvider {
  async scrapeByHashtag(): Promise<RawPost[]> {
    throw new Error("YouTube campaign/hashtag tracking is out of scope for this pass — see AGENTS.md");
  }

  async scrapeByHandle(handle: string): Promise<AccountSnapshot & { posts: RawPost[] }> {
    await delay(120);
    const posts = Array.from({ length: 12 }, (_, i) => toRawPost(`mock-yt-${i}`, i));
    return {
      handle: handle.replace(/^@/, ""),
      displayName: handle.replace(/^@/, ""),
      followers: 2_100_000,
      avgLikesPerPost: 7_200,
      postsPerWeek: 2.5,
      reelAvgViews: 410_000,
      engagementRateEstimate: 0.4,
      storyResponseRate: null,
      posts,
    };
  }

  async scrapeByUrls(urls: string[]): Promise<RawPost[]> {
    await delay(120);
    return urls.map((_, i) => toRawPost(`mock-yt-url-${i}`, i));
  }
}
