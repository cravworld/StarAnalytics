// Daily cron (see vercel.json) — records one CampaignBuzzSnapshot per live campaign. Not
// triggered from page views: a campaign nobody happens to open the dashboard for that day
// still gets a real data point, so the trend sparkline and the digest's week-over-week
// delta don't have gaps just because no one was looking. Same CRON_SECRET bearer-auth gate
// every other cron route in this project uses.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCampaignDetail } from "@/lib/data/campaigns";
import { recordBuzzSnapshot } from "@/lib/data/campaignBuzzSnapshots";
import { tryAcquireCronLock, releaseCronLock } from "@/lib/cronLock";

const LOCK_NAME = "snapshot-buzz";

// Loops over live campaigns doing DB reads only (getCampaignDetail, no Apify/Claude calls) —
// same reasoning as weekly-digest's maxDuration, fast even with more campaigns than exist
// today.
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!(await tryAcquireCronLock(LOCK_NAME, 300))) {
    return NextResponse.json({ skipped: true, reason: "previous invocation still running" });
  }

  try {
    const liveCampaigns = await prisma.campaign.findMany({ where: { status: "live" }, select: { id: true } });
    let recorded = 0;
    for (const { id } of liveCampaigns) {
      const detail = await getCampaignDetail(id);
      if (!detail) continue; // campaign deleted mid-run — skip, not fatal
      await recordBuzzSnapshot(id, detail.buzzScore);
      recorded++;
    }
    return NextResponse.json({ recorded, campaignCount: liveCampaigns.length });
  } finally {
    await releaseCronLock(LOCK_NAME);
  }
}
