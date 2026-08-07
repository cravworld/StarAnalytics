// Freshness of the ingest pipeline, for the banner in AppShell.
//
// Exists because of a real week-long outage: Apify's monthly cap was reached on
// 2026-07-31 and every hourly hashtag poll failed from then on, but the campaign
// screens kept rendering the last successful scrape's numbers with nothing marking
// them as stale. Someone reading /campaigns on 2026-08-07 saw seven-day-old figures
// presented exactly like live ones. This is the signal that was missing.
import { prisma } from "@/lib/prisma";
import { isQuotaCircuitOpen, readQuotaCircuit, QUOTA_ERROR_MARKER } from "@/lib/apify/quotaBreaker";

export type PipelineStatus = "ok" | "stale" | "down";

export interface PipelineHealth {
  status: PipelineStatus;
  /** Newest successful scrape_runs row of any kind. */
  lastSuccessAt: Date | null;
  /** Newest post actually written — what the campaign screens are showing. */
  newestPostAt: Date | null;
  /** True when Apify is rejecting on the monthly spend cap specifically. */
  quotaExhausted: boolean;
  failuresLast24h: number;
}

/**
 * Thresholds are read off the cron cadence, not picked for roundness.
 * poll-hashtags runs hourly (`0 * * * *`), so:
 *  - up to 3h: a missed tick or a slow one. Not news, and a banner here would train
 *    people to ignore the banner.
 *  - 3-12h: several consecutive ticks produced nothing. Worth flagging, but a scrape
 *    can legitimately return zero new posts for a quiet hashtag, so this stays soft.
 *  - 12h+, or a quota rejection at all: the pipeline is not running. A quota rejection
 *    short-circuits to "down" regardless of age because it is a positive signal of
 *    breakage, not an inference from silence.
 */
export const STALE_AFTER_HOURS = 3;
export const DOWN_AFTER_HOURS = 12;

export function classifyPipelineHealth({
  lastSuccessAt,
  quotaExhausted,
  now,
}: {
  lastSuccessAt: Date | null;
  quotaExhausted: boolean;
  now: number;
}): PipelineStatus {
  if (quotaExhausted) return "down";
  // No successful run has ever been recorded — a fresh deployment looks identical to a
  // permanently broken one from here, and "down" is the safer of the two to show.
  if (!lastSuccessAt) return "down";
  const hours = (now - lastSuccessAt.getTime()) / 3_600_000;
  if (hours >= DOWN_AFTER_HOURS) return "down";
  if (hours >= STALE_AFTER_HOURS) return "stale";
  return "ok";
}

export async function getPipelineHealth(): Promise<PipelineHealth> {
  const since24h = new Date(Date.now() - 24 * 3_600_000);
  const [circuit, newestPost, failuresLast24h] = await Promise.all([
    readQuotaCircuit(),
    prisma.post.findFirst({ orderBy: { scrapedAt: "desc" }, select: { scrapedAt: true } }),
    // finishedAt, not startedAt: a run rejected at the quota never starts, so its
    // startedAt stays null and a startedAt-based window silently reports zero failures
    // during exactly the outage it is meant to catch.
    prisma.scrapeRun.count({ where: { status: "error", finishedAt: { gte: since24h } } }),
  ]);

  const quotaExhausted = isQuotaCircuitOpen({ ...circuit, now: Date.now() });

  return {
    status: classifyPipelineHealth({
      lastSuccessAt: circuit.lastSuccessAt,
      quotaExhausted,
      now: Date.now(),
    }),
    lastSuccessAt: circuit.lastSuccessAt,
    newestPostAt: newestPost?.scrapedAt ?? null,
    quotaExhausted,
    failuresLast24h,
  };
}

// Re-exported so the banner can describe the cause without importing the Apify layer.
export { QUOTA_ERROR_MARKER };
