// Tells the local capture script what to collect.
//
// The event code, movie slug and city list live on the campaign, so the script reads them
// from here rather than holding a second copy that could silently drift out of step with
// what the UI shows.
//
// Same shared-secret auth as the ingest route, and deliberately read-only: it returns the
// three fields needed to build public BookMyShow URLs and nothing else. No thresholds, no
// timestamps, no counts — a scheduled script has no use for them, and a leaked secret
// should expose as little as possible.
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { movieSlugFor } from "@/lib/data/theaterCampaigns";
import { resolveRegions } from "@/lib/bookmyshow/urls";

function secretMatches(provided: string | null): boolean {
  const expected = process.env.BOOKMYSHOW_CAPTURE_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.BOOKMYSHOW_CAPTURE_SECRET) {
    return NextResponse.json({ error: "BOOKMYSHOW_CAPTURE_SECRET is not configured" }, { status: 500 });
  }
  if (!secretMatches(request.headers.get("x-capture-secret"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const campaign = await prisma.theaterCampaign.findUnique({
    where: { id },
    select: { bmsEventCode: true, movieName: true, targetCityCodes: true, status: true },
  });
  if (!campaign) return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  if (campaign.status !== "active") {
    // A paused campaign should stop generating traffic even if its scheduled task is still
    // enabled — pausing in the UI is the kill switch for collection, not just for display.
    return NextResponse.json({ error: `campaign is ${campaign.status}` }, { status: 409 });
  }

  // How many ingests the daily cap still allows.
  //
  // Returned so the script can stop BEFORE it opens a browser. Without it the cap is only
  // discovered at ingest, which is the worst possible moment: the pages have already been
  // fetched from BookMyShow and the result is then thrown away. Requests spent, nothing
  // learned — the same waste the city-window cap exists to avoid, one layer up.
  //
  // A count, not the policy: the ingest route stays the only thing that enforces it, so a
  // modified script cannot talk its way past the limit by ignoring this number.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const capturesToday = await prisma.bmsScanRun.count({
    where: { campaignId: id, provider: "capture", startedAt: { gte: since } },
  });
  const maxPerDay = Number(process.env.BOOKMYSHOW_CAPTURE_MAX_PER_DAY) || 6;

  return NextResponse.json({
    eventCode: campaign.bmsEventCode,
    movieSlug: movieSlugFor(campaign.movieName),
    // Resolved, so an empty configuration (meaning "all Kerala") arrives as the explicit
    // list rather than as an empty array the script would have to interpret.
    cityCodes: resolveRegions(campaign.targetCityCodes).map((r) => r.code),
    capturesRemaining: Math.max(0, maxPerDay - capturesToday),
  });
}
