// Parsing/aggregation test — mocks `fetch` with response shapes copied from
// developers.google.com (Data API v3) rather than a live account, matching the same
// "lock down the parsing, prove connectivity separately" approach as
// graph-instagram-insights.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeVideoItem } from "./youtube-normalize";
import { YouTubePublicContentProvider } from "./youtube-public-content";

function jsonResponse(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

describe("normalizeVideoItem", () => {
  it("maps a long-form video into RawPost", () => {
    const post = normalizeVideoItem(
      {
        id: "abc123",
        snippet: { title: "Title", description: "Desc", channelTitle: "Some Channel", publishedAt: "2026-01-01T00:00:00Z" },
        statistics: { viewCount: "150000", likeCount: "4200", commentCount: "310" },
        contentDetails: { duration: "PT4M33S" },
      },
      "competitor",
    );
    expect(post.platform).toBe("youtube");
    expect(post.igShortcode).toBe("abc123");
    expect(post.externalUrl).toBe("https://www.youtube.com/watch?v=abc123");
    expect(post.mediaType).toBe("video");
    expect(post.reach).toBe(150000);
    expect(post.likes).toBe(4200);
    expect(post.comments).toBe(310);
  });

  it("classifies a <=60s video as a short", () => {
    const post = normalizeVideoItem(
      { id: "s1", contentDetails: { duration: "PT45S" }, statistics: {}, snippet: {} },
      "competitor",
    );
    expect(post.mediaType).toBe("short");
  });
});

const CHANNEL_RESPONSE = {
  items: [
    {
      id: "UC123",
      snippet: { title: "Test Channel", customUrl: "@testchannel" },
      statistics: { subscriberCount: "500000" },
      contentDetails: { relatedPlaylists: { uploads: "UU123" } },
    },
  ],
};

const PLAYLIST_ITEMS_RESPONSE = {
  items: [{ contentDetails: { videoId: "v1" } }, { contentDetails: { videoId: "v2" } }],
};

const VIDEOS_RESPONSE = {
  items: [
    {
      id: "v1",
      snippet: { title: "Long video", channelTitle: "Test Channel", publishedAt: new Date(Date.now() - 14 * 86_400_000).toISOString() },
      statistics: { viewCount: "10000", likeCount: "500", commentCount: "20" },
      contentDetails: { duration: "PT5M0S" },
    },
    {
      id: "v2",
      snippet: { title: "Short video", channelTitle: "Test Channel", publishedAt: new Date().toISOString() },
      statistics: { viewCount: "80000", likeCount: "3000", commentCount: "100" },
      contentDetails: { duration: "PT30S" },
    },
  ],
};

function mockFetchImpl(urlStr: string) {
  const url = new URL(urlStr);
  if (url.pathname.endsWith("/channels")) return jsonResponse(CHANNEL_RESPONSE);
  if (url.pathname.endsWith("/playlistItems")) return jsonResponse(PLAYLIST_ITEMS_RESPONSE);
  if (url.pathname.endsWith("/videos")) return jsonResponse(VIDEOS_RESPONSE);
  throw new Error(`unexpected URL in test: ${urlStr}`);
}

describe("YouTubePublicContentProvider", () => {
  beforeEach(() => {
    process.env.YOUTUBE_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn((url: string) => mockFetchImpl(url)));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.YOUTUBE_API_KEY;
  });

  it("resolves a channel, fetches uploads, and aggregates account snapshot fields", async () => {
    const provider = new YouTubePublicContentProvider();
    const snapshot = await provider.scrapeByHandle("@testchannel");

    expect(snapshot.followers).toBe(500000);
    expect(snapshot.posts).toHaveLength(2);
    // avgLikesPerPost = (500 + 3000) / 2
    expect(snapshot.avgLikesPerPost).toBe(1750);
    // reelAvgViews computed only from the one "short" video (v2, 30s -> viewCount 80000)
    expect(snapshot.reelAvgViews).toBe(80000);
    expect(snapshot.storyResponseRate).toBeNull();
  });

  it("throws a clear error for scrapeByHashtag (out of scope this pass)", async () => {
    const provider = new YouTubePublicContentProvider();
    await expect(provider.scrapeByHashtag()).rejects.toThrow(/out of scope/i);
  });

  it("parses video IDs from watch and youtu.be URLs for scrapeByUrls", async () => {
    const provider = new YouTubePublicContentProvider();
    await provider.scrapeByUrls([
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/oHg5SJYRHA0",
    ]);
    const fetchMock = vi.mocked(fetch);
    const videosCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/videos"));
    expect(videosCall).toBeDefined();
    const requestedIds = new URL(String(videosCall![0])).searchParams.get("id");
    expect(requestedIds).toBe("dQw4w9WgXcQ,oHg5SJYRHA0");
  });
});
