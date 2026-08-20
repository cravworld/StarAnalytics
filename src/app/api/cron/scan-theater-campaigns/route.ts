// Scheduled BookMyShow demand scans.
//
// Same CRON_SECRET auth + fail-closed + cronLock pattern as every other cron here. Two
// extra gates specific to this feature:
//
//   - BOOKMYSHOW_MONITORING_ENABLED must be "true". Separate from DATA_MODE_BOOKMYSHOW so
//     that wiring up a live provider does not, by itself, start unattended traffic to a
//     third party's site every 90 minutes.
//   - Each campaign is scanned only once its own scanIntervalMinutes has elapsed. The cron
//     ticks far more often than any campaign's interval; this is what keeps a 6-hourly
//     campaign from being scanned every tick.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { raiseCampaignAlerts, runCampaignScan } from "@/lib/data/theaterCampaigns";
import { isMonitoringEnabled, bookMyShowConfigError } from "@/lib/bookmyshow/providers";
import { releaseCronLock, tryAcquireCronLock } from "@/lib/cronLock";
import { isApifyQuotaFailure } from "@/lib/apify/quotaBreaker";

export const maxDuration = 800;

const LOCK = "bms-scan-cron";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isMonitoringEnabled()) {
    return NextResponse.json({ skipped: "BOOKMYSHOW_MONITORING_ENABLED is not true" });
  }
  const configError = bookMyShowConfigError();
  if (configError) {
    return NextResponse.json({ skipped: configError });
  }

  // A Kerala-wide scan can outlast the gap between ticks; overlapping invocations would
  // duplicate third-party traffic for identical data.
  if (!(await tryAcquireCronLock(LOCK, maxDuration))) {
    return NextResponse.json({ skipped: "another scan tick is still running" });
  }

  try {
    const now = new Date();
    const campaigns = await prisma.theaterCampaign.findMany({
      where: { status: "active" },
      include: { scanRuns: { orderBy: { startedAt: "desc" }, take: 1 } },
    });

    const due = campaigns.filter((c) => {
      const last = c.scanRuns[0];
      if (!last) return true;
      return now.getTime() - last.startedAt.getTime() >= c.scanIntervalMinutes * 60_000;
    });

    const results: { campaignId: string; status: string; error?: string }[] = [];
    for (const campaign of due) {
      try {
        const result = await runCampaignScan(campaign.id, { now });
        // Alerts only on a scan that actually read something. Alerting off a failed scan
        // would be the exact false signal this feature is built to avoid — "no demand
        // anywhere" when the truth is "we could not look".
        if (result.status !== "error") {
          await raiseCampaignAlerts(campaign.id, { now });
        }
        results.push({ campaignId: campaign.id, status: result.status });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ campaignId: campaign.id, status: "error", error: message });
        // The spend cap is account-wide, so one quota rejection means the rest of this
        // tick cannot succeed either — same short-circuit the hashtag cron uses, and the
        // thing that turned ~120 doomed calls a day into ~24.
        if (isApifyQuotaFailure(err)) {
          console.error("[bms-scan] quota exhausted — abandoning the rest of this tick");
          break;
        }
      }
    }

    return NextResponse.json({ considered: campaigns.length, due: due.length, results });
  } finally {
    await releaseCronLock(LOCK);
  }
}
