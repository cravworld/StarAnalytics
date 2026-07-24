// Live PublicContentProvider for YouTube — plain fetch to the official Data API v3
// (API-key auth), NOT Apify/scraping: unlike Instagram, YouTube's public channel/video
// data has a real, accessible, ToS-clean official API, so no scraping actor is needed.
//
// Deliberately never calls search.list — it costs 100 of the default 10,000-unit daily
// quota per call (confirmed against developers.google.com, 2026-07-24), capping ~100
// calls/day. Every call this file makes (channels.list, playlistItems.list, videos.list)
// is a cheap list-by-id endpoint (~1 unit each), so this provider can't blow the quota
// polling a handful of tracked channels.
import type { AccountSnapshot, PublicContentProvider, RawPost } from "./types";
import { normalizeVideoItem, type YouTubeVideoItem } from "./youtube-normalize";

const API_BASE = "https://www.googleapis.com/youtube/v3";
const MAX_RECENT_VIDEOS = 25;

function apiKey(): string {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("YOUTUBE_API_KEY is not set — required for the live YouTube content provider");
  return key;
}

async function ytGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("key", apiKey());
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`YouTube Data API request failed (${path}): ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

interface ChannelListResponse {
  items: {
    id: string;
    snippet?: { title?: string; customUrl?: string };
    statistics?: { subscriberCount?: string };
    contentDetails?: { relatedPlaylists?: { uploads?: string } };
  }[];
}

interface PlaylistItemsResponse {
  items: { contentDetails?: { videoId?: string } }[];
}

interface VideoListResponse {
  items: YouTubeVideoItem[];
}

async function resolveChannel(handle: string) {
  const cleaned = handle.replace(/^@/, "").trim();
  const res = await ytGet<ChannelListResponse>("/channels", {
    part: "snippet,statistics,contentDetails",
    forHandle: cleaned,
  });
  const channel = res.items[0];
  if (!channel) throw new Error(`No YouTube channel found for handle "@${cleaned}"`);
  return channel;
}

async function uploadsVideoIds(uploadsPlaylistId: string, limit: number): Promise<string[]> {
  const res = await ytGet<PlaylistItemsResponse>("/playlistItems", {
    part: "contentDetails",
    playlistId: uploadsPlaylistId,
    maxResults: String(Math.min(limit, 50)),
  });
  return res.items.map((i) => i.contentDetails?.videoId).filter((id): id is string => Boolean(id));
}

async function videosByIds(ids: string[], source: RawPost["source"]): Promise<RawPost[]> {
  if (ids.length === 0) return [];
  // Up to 50 ids per call, comma-joined — one request, not N.
  const res = await ytGet<VideoListResponse>("/videos", {
    part: "snippet,statistics,contentDetails",
    id: ids.join(","),
  });
  return res.items.map((item) => normalizeVideoItem(item, source));
}

function parseVideoId(url: string): string | null {
  const watch = url.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
  if (watch) return watch[1];
  const short = url.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/);
  if (short) return short[1];
  return null;
}

// Real per-video postedAt spread from the fetched batch — a genuine estimate (unlike
// Instagram's scrapeByHandle, which leaves this at a documented 0 because a single
// post-history page doesn't carry enough signal there).
function estimatePostsPerWeek(posts: RawPost[]): number {
  if (posts.length < 2) return 0;
  const timestamps = posts.map((p) => new Date(p.postedAt).getTime()).sort((a, b) => a - b);
  const spanWeeks = (timestamps[timestamps.length - 1] - timestamps[0]) / (7 * 24 * 60 * 60 * 1000);
  return spanWeeks > 0 ? Math.round((posts.length / spanWeeks) * 10) / 10 : 0;
}

export class YouTubePublicContentProvider implements PublicContentProvider {
  async scrapeByHashtag(): Promise<RawPost[]> {
    // No accessible cheap primitive exists — YouTube's nearest equivalent, search.list,
    // costs 100 of the 10,000 daily quota units per call (~100 calls/day cap), which
    // doesn't fit this app's per-tag daily-poll pattern at all. Deliberately out of scope
    // for this pass rather than silently built wrong — campaigns/Hashtag Search stay
    // Instagram-only; see the multi-platform migration plan.
    throw new Error("YouTube campaign/hashtag tracking is out of scope for this pass — see AGENTS.md");
  }

  async scrapeByHandle(handle: string): Promise<AccountSnapshot & { posts: RawPost[] }> {
    const channel = await resolveChannel(handle);
    const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads;
    const videoIds = uploadsPlaylistId ? await uploadsVideoIds(uploadsPlaylistId, MAX_RECENT_VIDEOS) : [];
    const posts = await videosByIds(videoIds, "competitor");

    const followers = channel.statistics?.subscriberCount ? Number(channel.statistics.subscriberCount) : 0;
    const avgLikesPerPost = posts.length ? Math.round(posts.reduce((s, p) => s + p.likes, 0) / posts.length) : 0;
    const engagementRateEstimate = followers > 0 ? Math.round((avgLikesPerPost / followers) * 10000) / 100 : 0;

    // "Reel Avg Views" analog: real average viewCount across Shorts-classified videos in
    // this batch (mediaType === "short", the duration heuristic from youtube-normalize.ts).
    const shorts = posts.filter((p) => p.mediaType === "short");
    const reelAvgViews = shorts.length
      ? Math.round(shorts.reduce((s, p) => s + (p.reach ?? 0), 0) / shorts.length)
      : 0;

    return {
      handle: channel.snippet?.customUrl?.replace(/^@/, "") || handle.replace(/^@/, ""),
      displayName: channel.snippet?.title || handle,
      followers,
      avgLikesPerPost,
      postsPerWeek: estimatePostsPerWeek(posts),
      reelAvgViews,
      engagementRateEstimate,
      // YouTube has no Stories concept at all — always null. Same "not evaluated" pattern
      // as Instagram competitors' storyResponseRate (Graph-API-only there), just for a
      // different reason here (the feature doesn't exist on this platform).
      storyResponseRate: null,
      posts,
    };
  }

  async scrapeByUrls(urls: string[]): Promise<RawPost[]> {
    const ids = urls.map(parseVideoId).filter((id): id is string => Boolean(id));
    return videosByIds(ids, "agency");
  }
}
