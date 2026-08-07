// Circuit breaker for Apify's monthly spend cap.
//
// Once an account passes `maxMonthlyUsageUsd`, every actor start returns:
//
//   403 { "error": { "type": "platform-feature-disabled",
//                    "message": "Monthly usage hard limit exceeded" } }
//
// Nothing here treated that differently from a transient actor failure, so
// poll-hashtags kept firing one scrape per tracked hashtag every hour into a wall.
// Measured in prod on 2026-08-07: 1,098 failed `hashtag` runs against 76 successful
// ones all-time, no successful run of any kind since 2026-07-31T14:05Z, and nothing
// anywhere surfacing it — the app kept serving week-old campaign figures as current.
//
// The breaker's job is narrow: stop paying the latency (and any per-call cost) of
// requests that cannot succeed, while still probing often enough that raising the
// cap brings the pipeline back on its own.
import { prisma } from "@/lib/prisma";

// The stable, machine-readable half of Apify's payload.
export const QUOTA_ERROR_MARKER = "platform-feature-disabled";

/**
 * True only for Apify's own quota rejection.
 *
 * Deliberately matches the `type` and not the human-readable "Monthly usage hard
 * limit exceeded" text: `runAgencyBatchJob` writes whatever error it catches onto
 * its own `agency_batch` scrape_runs row, so a matcher loose enough to also match
 * ApifyQuotaExhaustedError's message would let every skip look like a fresh
 * rejection — refreshing the cooldown clock forever and permanently wedging the
 * circuit open. ApifyQuotaExhaustedError's wording is chosen to never match this.
 */
export function isApifyQuotaError(message: string | null | undefined): boolean {
  return typeof message === "string" && message.includes(QUOTA_ERROR_MARKER);
}

export class ApifyQuotaExhaustedError extends Error {
  constructor(actorId: string) {
    super(`Apify quota circuit is open — skipped ${actorId} without calling Apify.`);
    this.name = "ApifyQuotaExhaustedError";
  }
}

/**
 * 55 minutes, and the exact value matters.
 *
 * poll-hashtags runs at `0 * * * *` (see vercel.json). Anything ≥60 minutes means a
 * tick at 07:00 is still inside the window opened at 06:00 and gets skipped too, so
 * the pipeline only probes every second hour. Just under the hour gives exactly one
 * probe per tick.
 *
 * Note what this does and does not buy: the drop from ~120 to ~24 failed calls a day
 * comes almost entirely from the *within-tick* short-circuit — one rejection stops the
 * remaining hashtags in the same run. The cooldown only sets how long a cold start
 * takes to notice, and `isQuotaCircuitOpen` closes early on any success anyway.
 */
export const QUOTA_COOLDOWN_MS =
  (Number(process.env.APIFY_QUOTA_COOLDOWN_MINUTES) || 55) * 60 * 1000;

export interface QuotaCircuitInput {
  lastQuotaErrorAt: Date | null;
  lastSuccessAt: Date | null;
  now: number;
  cooldownMs?: number;
}

/**
 * Pure state function, so the recovery rule is testable without a database.
 *
 * The success check is what makes raising the Apify cap take effect immediately
 * rather than at the end of a cooldown: a completed run that is newer than the last
 * rejection is direct evidence the account can spend again.
 */
export function isQuotaCircuitOpen({
  lastQuotaErrorAt,
  lastSuccessAt,
  now,
  cooldownMs = QUOTA_COOLDOWN_MS,
}: QuotaCircuitInput): boolean {
  if (!lastQuotaErrorAt) return false;
  if (lastSuccessAt && lastSuccessAt.getTime() > lastQuotaErrorAt.getTime()) return false;
  return now - lastQuotaErrorAt.getTime() < cooldownMs;
}

/**
 * Circuit state, derived entirely from the scrape_runs audit trail rather than a
 * separate table. No migration, and no state that can drift out of sync with what
 * actually happened — a skip writes no row (see assertQuotaCircuitClosed), so the
 * timestamps this reads only ever move on real Apify outcomes.
 */
export async function readQuotaCircuit(): Promise<{
  lastQuotaErrorAt: Date | null;
  lastSuccessAt: Date | null;
}> {
  const [quotaError, success] = await Promise.all([
    prisma.scrapeRun.findFirst({
      where: { status: "error", error: { contains: QUOTA_ERROR_MARKER } },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
    // apifyRunId is the discriminator, not the kind, and that matters. scrape_runs
    // holds two different things: actor-level rows written by trackedRun, and
    // job-level rows like `agency_batch` that src/lib/actions/agency.ts opens and
    // runAgencyBatchJob closes once *scoring* finishes. An agency_batch "done" says
    // nothing about whether Apify is reachable — a batch whose rows yield no
    // resolvable URLs completes without ever calling scrapeByUrls. Counting one as a
    // success would close the circuit on evidence that isn't evidence, and make the
    // banner report a live pipeline while it is still dead. Only trackedRun ever sets
    // apifyRunId, and only after runActor has actually returned a run.
    prisma.scrapeRun.findFirst({
      where: { status: "done", apifyRunId: { not: null } },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
  ]);
  return {
    lastQuotaErrorAt: quotaError?.finishedAt ?? null,
    lastSuccessAt: success?.finishedAt ?? null,
  };
}

/**
 * Throws ApifyQuotaExhaustedError if the circuit is open.
 *
 * Callers must not record a scrape_runs row for a skip. Two reasons: the run never
 * happened so the audit trail would be fiction, and a synthetic error row would push
 * `lastQuotaErrorAt` forward on every skip, which is precisely the feedback loop that
 * would stop the circuit from ever re-probing.
 */
export async function assertQuotaCircuitClosed(actorId: string): Promise<void> {
  const state = await readQuotaCircuit();
  if (isQuotaCircuitOpen({ ...state, now: Date.now() })) {
    throw new ApifyQuotaExhaustedError(actorId);
  }
}
