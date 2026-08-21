// Ingest endpoint for the local capture script (scripts/bms-capture.mjs).
//
// BookMyShow's anti-bot protection blocks server-side collection (see
// BOOKMYSHOW-FEASIBILITY.md §8), so the data is gathered by a real browser on an operator's
// own machine and POSTed here. This route is the only thing that path adds to the server —
// everything downstream is the same ingestScrapeItems() pipeline a provider-driven scan
// uses, so both routes to the data share one definition of the truth.
//
// Authenticated with a shared secret rather than a session: the caller is a scheduled
// script with no browser and no user to log in as. That makes this the one campaign
// endpoint not behind NextAuth, so it is deliberately narrow — it accepts one payload
// shape, for one campaign, and can do nothing else.
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ingestScrapeItems, markLatestRunFailed, raiseCampaignAlerts } from "@/lib/data/theaterCampaigns";
import { releaseCronLock, tryAcquireCronLock } from "@/lib/cronLock";
import type { BmsScrapeItem } from "@/lib/bookmyshow/types";

export const maxDuration = 300;

/** Hard ceiling on payload size — a Kerala-wide sweep is ~90 items. */
const MAX_ITEMS = 500;

/**
 * Daily cap per campaign, counted in PAGES rather than runs.
 *
 * The script has its own pacing, but a client-side limit is a suggestion — this is the one
 * that holds. It exists because the whole justification for this collection path is that it
 * stays at human-scale volume; a runaway scheduled task that ran every minute would destroy
 * that justification, and nobody would notice until BookMyShow did.
 *
 * It used to count RUNS, capped at 6. That was sized when a run meant thirty to ninety
 * pages. A run is now three — one district over three days — so the old cap allowed
 * eighteen pages a day, roughly a tenth of what it was written to permit, and it became the
 * binding constraint instead of the backstop it was meant to be.
 *
 * Volume is what the justification is about, so volume is what is counted. Many small runs
 * and one large sweep now cost what they actually cost.
 */
const MAX_PAGES_PER_DAY = Number(process.env.BOOKMYSHOW_CAPTURE_MAX_PAGES_PER_DAY) || 120;

function secretMatches(provided: string | null): boolean {
  const expected = process.env.BOOKMYSHOW_CAPTURE_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // Length check first — timingSafeEqual throws on a length mismatch.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.BOOKMYSHOW_CAPTURE_SECRET) {
    // Fail closed, same discipline as the cron routes: an unset secret must never mean
    // "open", it means "this endpoint is not configured".
    return NextResponse.json({ error: "BOOKMYSHOW_CAPTURE_SECRET is not configured" }, { status: 500 });
  }
  if (!secretMatches(request.headers.get("x-capture-secret"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const campaign = await prisma.theaterCampaign.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!campaign) return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  if (campaign.status === "archived") {
    return NextResponse.json({ error: "campaign is archived" }, { status: 409 });
  }

  let body: { items?: unknown; requested?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const items = body.items;
  if (!Array.isArray(items)) {
    return NextResponse.json({ error: "body.items must be an array" }, { status: 400 });
  }
  if (items.length === 0) {
    return NextResponse.json({ error: "body.items is empty — nothing to ingest" }, { status: 400 });
  }
  if (items.length > MAX_ITEMS) {
    return NextResponse.json({ error: `too many items (max ${MAX_ITEMS})` }, { status: 413 });
  }
  // Shape check only. The real defence against malformed content is normalizeCityPage,
  // which skips-with-a-reason rather than trusting anything — this just rejects payloads
  // that are not even the right kind of thing.
  const malformed = items.findIndex(
    (i) => !i || typeof i !== "object" || typeof (i as BmsScrapeItem).cityCode !== "string",
  );
  if (malformed >= 0) {
    return NextResponse.json({ error: `items[${malformed}] is missing cityCode` }, { status: 400 });
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const spent = await prisma.bmsScanRun.aggregate({
    where: { campaignId: id, provider: "capture", startedAt: { gte: since } },
    _sum: { citiesRequested: true },
  });
  const pagesToday = spent._sum.citiesRequested ?? 0;
  if (pagesToday >= MAX_PAGES_PER_DAY) {
    return NextResponse.json(
      {
        error: `daily page limit reached (${pagesToday} of ${MAX_PAGES_PER_DAY} in the last 24h). This cap keeps collection at human-scale volume, which is the basis on which it is done at all.`,
      },
      { status: 429 },
    );
  }

  // Same lock the manual scan uses, so a capture cannot interleave with a scan of the same
  // campaign. The snapshot unique constraint would keep the DATA correct regardless; this
  // avoids two writers racing over the same rows.
  const lockName = `bms-scan:${id}`;
  if (!(await tryAcquireCronLock(lockName, maxDuration))) {
    return NextResponse.json({ error: "a scan or capture is already running for this campaign" }, { status: 409 });
  }

  const now = new Date();
  try {
    const scanRun = await prisma.bmsScanRun.create({
      data: {
        campaignId: id,
        status: "running",
        // Distinct from "apify" and "mock" so the UI can say where a number came from, and
        // so the daily cap above counts only this path.
        provider: "capture",
        citiesRequested: typeof body.requested === "number" ? body.requested : items.length,
        startedAt: now,
      },
    });

    const result = await ingestScrapeItems({
      campaignId: id,
      scanRunId: scanRun.id,
      items: items as BmsScrapeItem[],
      now,
      requested: typeof body.requested === "number" ? body.requested : items.length,
    });

    if (result.status !== "error") {
      await raiseCampaignAlerts(id, { now });
    }

    return NextResponse.json(result, { status: result.status === "error" ? 502 : 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[bms-capture] ingest failed campaign=${id}:`, message);
    // Same reason as the manual scan route: a run left saying `running` is a failure the
    // scan status panel can never report. The capture script is unattended, so that panel
    // is the only place the operator would ever find out.
    await markLatestRunFailed(id, message);
    return NextResponse.json({ error: "ingest failed" }, { status: 500 });
  } finally {
    await releaseCronLock(lockName);
  }
}
