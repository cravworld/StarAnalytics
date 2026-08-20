// Manual "Scan now".
//
// A route handler rather than a Server Action because a Kerala-wide scan renders ~90 pages
// through Apify and needs its own maxDuration — Server Actions inherit the page's. Same
// reasoning as src/app/api/scout/upload/route.ts choosing a route handler for its own
// constraint.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { runCampaignScan } from "@/lib/data/theaterCampaigns";
import { bookMyShowConfigError } from "@/lib/bookmyshow/providers";
import { tryAcquireCronLock, releaseCronLock } from "@/lib/cronLock";
import { isApifyQuotaFailure } from "@/lib/apify/quotaBreaker";

// Must stay above BOOKMYSHOW_RUN_WAIT_MS (default 8 min) plus ingest time, or the function
// is killed mid-wait and the Apify run is orphaned — billed, with nobody reading it. This
// is the failure mode src/lib/apify/client.ts documents at length.
export const maxDuration = 800;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  const configError = bookMyShowConfigError();
  if (configError) {
    // 503, not 500: the code is fine, the deployment is not configured for live scanning.
    return NextResponse.json({ error: configError }, { status: 503 });
  }

  // One scan per campaign at a time. Without this, an impatient double-click starts two
  // Kerala-wide runs — double the third-party traffic and double the Apify spend for
  // identical data. The snapshot unique constraint keeps the DATA correct either way; this
  // is about not paying twice.
  const lockName = `bms-scan:${id}`;
  const acquired = await tryAcquireCronLock(lockName, maxDuration);
  if (!acquired) {
    return NextResponse.json(
      { error: "A scan is already running for this campaign. Wait for it to finish." },
      { status: 409 },
    );
  }

  try {
    const result = await runCampaignScan(id);
    return NextResponse.json(result, { status: result.status === "error" ? 502 : 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isApifyQuotaFailure(err)) {
      return NextResponse.json(
        { error: "Apify's monthly spend limit has been reached — scans are paused until it resets or is raised." },
        { status: 503 },
      );
    }
    console.error(`[bms-scan] manual scan failed campaign=${id}:`, message);
    // The message only. Never the error object or the actor input — those carry request
    // shapes and configuration that have no business in a browser response.
    return NextResponse.json({ error: "Scan failed. See the scan status panel for details." }, { status: 500 });
  } finally {
    await releaseCronLock(lockName);
  }
}
