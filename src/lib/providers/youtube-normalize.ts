// Raw YouTube Data API v3 video resource -> canonical RawPost. Mirrors apify-normalize.ts's
// "one function per source, isolate the API's field quirks" discipline — nothing downstream
// of this file should ever see a raw YouTube API response shape.
//
// Field names verified against developers.google.com (v3) on 2026-07-24: video resource
// snippet.{title,description,channelTitle,publishedAt}, statistics.{viewCount,likeCount,
// commentCount} (all returned as strings, not numbers), contentDetails.duration (ISO 8601,
// e.g. "PT1M33S").
import type { RawPost } from "./types";

export interface YouTubeVideoItem {
  id: string;
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    // Stable channel identifier. channelTitle is a display name — mutable and not unique —
    // so anything that groups or dedups by account must key on this instead. Added for
    // Campaign Post Tracking, which groups tracked posts by the account that posted them.
    channelId?: string;
    publishedAt?: string;
  };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
  contentDetails?: {
    duration?: string;
  };
}

// Only handles the H/M/S components a video duration actually uses — no years/months/weeks.
function durationSeconds(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const [, h, min, s] = m;
  return Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0);
}

// YouTube's API exposes no explicit "is this a Short" flag on the video resource — this is
// a duration heuristic (<=60s, matching YouTube's own Shorts eligibility rule), not an
// authoritative field. Good enough for a mediaType label; don't rely on it as a hard boundary.
function mediaTypeFor(item: YouTubeVideoItem): string {
  const seconds = durationSeconds(item.contentDetails?.duration);
  return seconds !== null && seconds <= 60 ? "short" : "video";
}

export function normalizeVideoItem(item: YouTubeVideoItem, source: RawPost["source"]): RawPost {
  return {
    id: item.id,
    source,
    platform: "youtube",
    // Field name is a carryover from when this column only ever held an Instagram
    // shortcode — kept as-is rather than renamed across 9 call sites on a live table (see
    // the multi-platform migration notes). Holds the YouTube video ID here.
    igShortcode: item.id,
    externalUrl: `https://www.youtube.com/watch?v=${item.id}`,
    authorHandle: item.snippet?.channelTitle ?? "",
    mediaType: mediaTypeFor(item),
    caption: [item.snippet?.title, item.snippet?.description].filter(Boolean).join("\n"),
    postedAt: item.snippet?.publishedAt ?? new Date().toISOString(),
    // viewCount is public and plays the "how many people saw this" role Instagram's private
    // `reach` metric would on the same field — not an identical measurement (raw play count,
    // not unique accounts reached), but the closest honest analogue available.
    reach: item.statistics?.viewCount ? Number(item.statistics.viewCount) : null,
    likes: item.statistics?.likeCount ? Number(item.statistics.likeCount) : 0,
    comments: item.statistics?.commentCount ? Number(item.statistics.commentCount) : 0,
    saves: null,
    shares: null,
    raw: item as unknown as Record<string, unknown>,
  };
}
