import { CAMPAIGNS, TRACKED_HASHTAGS, VIJAYAM_DETAIL } from "@/lib/providers/seed";
import { prisma } from "@/lib/prisma";
import type { RawPost } from "@/lib/providers/types";

export async function getOwnCampaigns() {
  return {
    campaigns: CAMPAIGNS,
    kpis: { active: 2, totalHashtagReach: "28.4M", hashtagsTracked: 8 },
  };
}

const STREAM_PALETTE = [
  { bg: "#fde8ef", c: "#E1306C" },
  { bg: "#e8f5e9", c: "#1a7a4a" },
  { bg: "#e3f2fd", c: "#1565c0" },
  { bg: "#f3e5f5", c: "#6a1b9a" },
];

function toStreamItem(p: RawPost, i: number) {
  const initials = p.authorHandle.replace(/^@/, "").slice(0, 2).toUpperCase() || "??";
  const palette = STREAM_PALETTE[i % STREAM_PALETTE.length];
  return {
    av: initials,
    bg: palette.bg,
    c: palette.c,
    handle: p.authorHandle.startsWith("@") ? p.authorHandle : `@${p.authorHandle}`,
    time: new Date(p.postedAt).toLocaleString(),
    text: p.caption,
    likes: String(p.likes),
    comments: String(p.comments),
    tag: "Public",
  };
}

export async function getVijayamDetail() {
  // Reads whatever `posts` currently holds for #vijayam — populated by the dev
  // scrape trigger (or, from Phase 2, the polling cron), never scraped on the read
  // path itself: a live Apify run takes 10-20s and costs real money per result,
  // so it cannot run on every page load.
  const dbPosts = await prisma.post.findMany({
    where: { source: "campaign", igShortcode: { not: null } },
    orderBy: { postedAt: "desc" },
    take: 20,
  });

  if (dbPosts.length === 0) return VIJAYAM_DETAIL;

  const stream = dbPosts.map((p, i) =>
    toStreamItem(
      {
        id: p.id,
        source: "campaign",
        igShortcode: p.igShortcode ?? "",
        externalUrl: p.externalUrl ?? "",
        authorHandle: p.authorHandle ?? "",
        mediaType: p.mediaType ?? "image",
        caption: p.caption ?? "",
        postedAt: (p.postedAt ?? p.scrapedAt).toISOString(),
        reach: p.reach,
        likes: p.likes ?? 0,
        comments: p.comments ?? 0,
        saves: p.saves,
        shares: p.shares,
        raw: (p.raw as Record<string, unknown>) ?? {},
      },
      i,
    ),
  );

  return { ...VIJAYAM_DETAIL, stream };
}

export async function getTrackedHashtags() {
  return TRACKED_HASHTAGS;
}
