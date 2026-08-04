// Follower-count history for competitor and fan-page accounts — CompetitorAccount.followers
// and FanPage.followers stay single overwritten snapshots (unchanged everywhere else), this
// is the history neither of them ever kept. See AccountSnapshot in schema.prisma.
//
// Deliberately zero new Apify calls: recordAccountSnapshot is only ever called from the same
// scrape functions (scrapeCompetitor, scrapeYouTubeFanChannel, addFanPage's Instagram branch)
// that already fetch a fresh follower count for another reason — this just also keeps the row.
import { prisma } from "@/lib/prisma";
import type { PlatformId } from "@/lib/providers/types";

export async function recordAccountSnapshot(platform: PlatformId, igHandle: string, followers: number | null): Promise<void> {
  if (followers === null) return; // nothing real to record
  await prisma.accountSnapshot.create({ data: { platform, igHandle, followers } });
}

export interface FollowerTrend {
  values: number[]; // chronological, oldest first
  deltaPct: number | null; // change from first to last point in `values`; null if <2 points
}

const MAX_POINTS = 20;

function trendKey(platform: PlatformId, igHandle: string): string {
  return `${platform}:${igHandle}`;
}

// Batched to avoid N+1 queries when rendering a list (Compare columns, Fan Pages rows) — one
// query for every handle on the page, not one query per row.
export async function getFollowerTrends(
  handles: { platform: PlatformId; igHandle: string }[],
): Promise<Map<string, FollowerTrend>> {
  if (handles.length === 0) return new Map();

  const rows = await prisma.accountSnapshot.findMany({
    where: { OR: handles.map((h) => ({ platform: h.platform, igHandle: h.igHandle })) },
    orderBy: { capturedAt: "asc" },
  });

  const byHandle = new Map<string, number[]>();
  for (const r of rows) {
    const key = trendKey(r.platform, r.igHandle);
    const arr = byHandle.get(key) ?? [];
    arr.push(r.followers);
    byHandle.set(key, arr);
  }

  const result = new Map<string, FollowerTrend>();
  for (const [key, allValues] of byHandle) {
    const values = allValues.slice(-MAX_POINTS);
    const deltaPct =
      values.length >= 2 && values[0] > 0
        ? Math.round(((values[values.length - 1] - values[0]) / values[0]) * 1000) / 10
        : null;
    result.set(key, { values, deltaPct });
  }
  return result;
}

export function lookupTrend(
  trends: Map<string, FollowerTrend>,
  platform: PlatformId,
  igHandle: string,
): FollowerTrend {
  return trends.get(trendKey(platform, igHandle)) ?? { values: [], deltaPct: null };
}
