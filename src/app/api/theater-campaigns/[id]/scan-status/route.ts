// Scan status for the campaign page's polling banner.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const run = await prisma.bmsScanRun.findFirst({
    where: { campaignId: id },
    orderBy: { startedAt: "desc" },
    include: { cityResults: { where: { status: { not: "ok" } } } },
  });

  if (!run) return NextResponse.json({ lastScan: null });

  // Explicitly shaped, never the raw row. Two reasons: the Next server-actions guide's
  // "constrain return values" rule, and specifically so `apifyRunId` / `datasetId` — which
  // identify billable resources on our Apify account — never reach a browser.
  return NextResponse.json({
    lastScan: {
      id: run.id,
      status: run.status,
      provider: run.provider,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      citiesRequested: run.citiesRequested,
      citiesSucceeded: run.citiesSucceeded,
      theatersStored: run.theatersStored,
      screeningsStored: run.screeningsStored,
      snapshotsStored: run.snapshotsStored,
      recordsSkipped: run.recordsSkipped,
      recordsUnmapped: run.recordsUnmapped,
      error: run.error,
      failedCities: run.cityResults.map((c) => ({
        cityCode: c.cityCode,
        status: c.status,
        error: c.error,
      })),
    },
  });
}
