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
import { readAccountUsage } from "@/lib/apify/client";
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
 * "Did this failure mean the account can't spend right now?" — the question every loop
 * that scrapes more than one thing needs to ask before trying the next one.
 *
 * Covers both shapes it can arrive in: the pre-emptive skip this module throws, and a real
 * Apify rejection whose message carries the marker. The spend cap is account-wide, so one
 * of these means the rest of the loop cannot succeed either.
 */
export function isApifyQuotaFailure(err: unknown): boolean {
  if (err instanceof ApifyQuotaExhaustedError) return true;
  return isApifyQuotaError(err instanceof Error ? err.message : null);
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
 * Headroom we refuse to spend into, so the account never reaches the hard cap.
 *
 * The 403 breaker above is reactive by construction: it needs a rejection to have
 * happened. This is the proactive half — the cap gets *approached* by a run that was
 * legal when it started, and Apify aborts that run partway through with a generic
 * ABORTED status carrying no quota marker anywhere in it (see the mid-run detection in
 * trackedRun). Stopping half a run costs the money already spent on it and stores
 * nothing usable, so it's cheaper to not start it.
 */
export const BUDGET_RESERVE_USD = Number(process.env.APIFY_MONTHLY_RESERVE_USD) || 1;

// Account usage barely moves between two runs a few seconds apart, and this is an
// unmetered platform call rather than an actor run — but it is still a network round
// trip in front of every scrape, so hold the answer briefly. Per-instance and
// deliberately short: long enough to cover one cron tick's burst of runs, short enough
// that adding credits takes effect within a minute rather than at the next cold start.
const USAGE_CACHE_MS = 60 * 1000;
let usageCache: { checkedAt: number; exhausted: boolean } | null = null;

/**
 * True when the account has less than BUDGET_RESERVE_USD of monthly headroom left.
 *
 * Fails *open* (returns false) when the usage endpoint is unreachable — an Apify API
 * blip must not be able to halt ingestion on its own, and the 403 breaker still covers
 * the start-time rejection independently.
 */
export async function isAccountBudgetExhausted(): Promise<boolean> {
  if (usageCache && Date.now() - usageCache.checkedAt < USAGE_CACHE_MS) return usageCache.exhausted;
  const usage = await readAccountUsage();
  if (!usage) return false;
  const exhausted = usage.maxMonthlyUsageUsd - usage.monthlyUsageUsd <= BUDGET_RESERVE_USD;
  usageCache = { checkedAt: Date.now(), exhausted };
  return exhausted;
}

/** Test seam — the cache is module state, so it has to be clearable. */
export function resetAccountBudgetCache(): void {
  usageCache = null;
}

/**
 * Throws ApifyQuotaExhaustedError if the circuit is open, or if the account has no
 * meaningful budget left.
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
  if (await isAccountBudgetExhausted()) {
    throw new ApifyQuotaExhaustedError(actorId);
  }
}
