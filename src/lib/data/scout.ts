// Scoutline orchestration: upload -> batch/candidates persisted -> Apify run(s) kicked off
// and tracked in ScoutRun -> a cron ingests finished runs into ScoutSnapshot/ScoutScore.
//
// Deliberately asynchronous end-to-end (see client.ts's own warning: a route killed
// mid-wait orphans a billed, unread Apify run). createScoutBatch + startScoutRuns return
// as soon as the run is *started*, not finished — src/app/api/cron/poll-scout-runs/route.ts
// does the waiting.
//
// Facebook support (2026-08-18) branches by platform at the chunking/actor level — a single
// batch can hold both Instagram and Facebook candidates, and each platform uses a completely
// different actor with a different cost/timing shape, so "one chunking scheme fits both"
// was never true. Facebook is deliberately page-only ("not take the posts into account...
// based on the people talking about this" — 2026-08-18 direction): apify/facebook-pages-
// scraper alone, no post-scraping actor, no consistency/content-mix signal for Facebook
// candidates (they stay null and get excluded, same discipline scoreInfluencer.ts already
// has for any missing signal).
import type { ScoutPlatform } from "@prisma/client";
import { getDatasetItems, getRunStatus, runActor } from "@/lib/apify/client";
import { normalizeScoutItem } from "@/lib/providers/apify-scout-normalize";
import { normalizeFacebookScoutItem } from "@/lib/providers/apify-scout-normalize-facebook";
import { prisma } from "@/lib/prisma";
import { scoreInfluencer } from "@/lib/scoring/scoreInfluencer";
import { getScoutSettings } from "@/lib/data/scoutSettings";
import { profileUrlKey, type ParsedCandidate } from "@/lib/scout/ingest";

// 2026-08-17 direction: Instagram's single actor is the whole pipeline for that platform —
// no separate profile/post/comment-scraper pass, no authenticity component. Overridable so
// a future environment (or a switch back to a different actor) doesn't need a code change.
export const INSTAGRAM_ACTOR_ID =
  process.env.APIFY_ACTOR_SCOUT || "easy_scraper/instagram-profile-engagement-analytics";
// apify/facebook-pages-scraper — confirmed live (2026-08-18) against real pages. Takes no
// configurable factors beyond the URL list itself.
export const FACEBOOK_ACTOR_ID = process.env.APIFY_ACTOR_SCOUT_FACEBOOK || "apify/facebook-pages-scraper";

// Chunk size and per-run timeout both scale with postsToAnalyze — a fixed 40-handle chunk
// was sized around a 15-posts-per-account baseline (confirmed live: ~0.9s of actor runtime
// per profile-post analyzed). At postsToAnalyze=100 that same 40-handle chunk would run
// ~6.7x longer than the 600s timeout it was tuned for — confirmed the hard way on the first
// real batch, where even the 15-post baseline timed out once on ordinary proxy variance.
// Keeping "handles x postsToAnalyze" roughly constant across settings keeps both the
// per-chunk wall-clock and the blast radius of one bad chunk stable regardless of how deep
// a scan is configured to go.
const IG_TARGET_CHUNK_WORK_UNITS = 40 * 15;
const IG_SECONDS_PER_WORK_UNIT = 2; // ~2.2x the observed ~0.9s/unit, as margin against a slow run

function igChunkSize(postsToAnalyze: number): number {
  return Math.max(1, Math.min(40, Math.floor(IG_TARGET_CHUNK_WORK_UNITS / postsToAnalyze)));
}

function igTimeoutSecs(handleCount: number, postsToAnalyze: number): number {
  return Math.max(300, Math.ceil(handleCount * postsToAnalyze * IG_SECONDS_PER_WORK_UNIT));
}

// $0.0006/post analyzed (confirmed via a live run's pricingInfo) + $0.0001/dataset item +
// a fixed $0.001 actor-start charge. 50% headroom over the arithmetic max for a chunk since
// analysis cost is bounded above by chunkSize x postsToAnalyze regardless of how active the
// real accounts are — there's no "per-URL multiplies unboundedly" risk here the way the
// comment-scraper has (see client.ts's own warning about that actor).
function igMaxChargeUsd(handleCount: number, postsToAnalyze: number): number {
  const arithmeticMax = handleCount * postsToAnalyze * 0.0006 + handleCount * 0.0001 + 0.001;
  return Math.ceil(arithmeticMax * 1.5 * 100) / 100;
}

// Facebook: no "depth" dimension at all (page-only, no posts scraped), so cost/time scale
// purely with handle count. $0.0065/page confirmed live via a real run's pricingInfo.
// Fixed 40/chunk matches Instagram's own ceiling; timeout is generous relative to the
// ~6-11s/page observed live, since Facebook scraping is confirmed less consistently paced
// than Instagram's (one of three live verification runs came back empty and needed a
// retry — see apify-scout-normalize-facebook.ts's module doc).
const FB_CHUNK_SIZE = 40;
function fbTimeoutSecs(handleCount: number): number {
  return Math.max(180, handleCount * 15);
}
function fbMaxChargeUsd(handleCount: number): number {
  return Math.ceil((handleCount * 0.0065 * 1.5 + 0.01) * 100) / 100;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface CreateBatchResult {
  batchId: string;
  expectedCount: number;
  parsedCount: number;
}

/** Persists the batch + deduped candidates + per-batch entries. Does not start any Apify run. */
export async function createScoutBatch(
  fileName: string,
  sourceType: "pdf" | "excel" | "manual",
  rowsFound: number,
  candidates: ParsedCandidate[],
): Promise<CreateBatchResult> {
  const batch = await prisma.scoutBatch.create({
    data: { fileName, sourceType, expectedCount: rowsFound, parsedCount: candidates.length },
  });

  // Bulk, not one upsert-pair per candidate — a 202-account batch was doing ~404 sequential
  // DB round-trips here alone, the dominant cause of the real /api/scout/upload 504 in
  // production. Same end state (dedup by profileUrlKey, one entry per candidate in this
  // batch), 3 queries total instead of hundreds.
  const byKey = new Map(candidates.map((c) => [profileUrlKey(c.handle, c.platform), c]));
  const keys = [...byKey.keys()];
  const existing = await prisma.scoutCandidate.findMany({ where: { profileUrlKey: { in: keys } } });
  const existingByKey = new Map(existing.map((c) => [c.profileUrlKey, c]));

  const newKeys = keys.filter((k) => !existingByKey.has(k));
  if (newKeys.length > 0) {
    await prisma.scoutCandidate.createMany({
      data: newKeys.map((k) => {
        const c = byKey.get(k)!;
        return { handle: c.handle, platform: c.platform, profileUrlKey: k };
      }),
      skipDuplicates: true, // belt-and-braces against a race with another concurrent upload
    });
    const created = await prisma.scoutCandidate.findMany({ where: { profileUrlKey: { in: newKeys } } });
    for (const c of created) existingByKey.set(c.profileUrlKey, c);
  }

  await prisma.scoutBatchEntry.createMany({
    // batchId is brand new (just created above), so there can be no pre-existing entry for
    // it — plain createMany, no upsert semantics needed the way an old per-row loop had.
    data: candidates.map((c) => ({
      batchId: batch.id,
      candidateId: existingByKey.get(profileUrlKey(c.handle, c.platform))!.id,
      rowNumber: c.rowNumber,
      suppliedName: c.name,
      deliverable: c.deliverable,
    })),
  });

  return { batchId: batch.id, expectedCount: rowsFound, parsedCount: candidates.length };
}

// A chunk that hit its timeout (proxy/rate variance, not a cost or code issue — confirmed
// on the very first real batch: 1 of 6 identically-sized chunks timed out while the other 5
// succeeded at the same settings) gets a longer window on retry rather than the same one
// again.
const RETRY_TIMEOUT_MULTIPLIER = 2;

// Concurrent, not sequential — a deep Instagram scan (postsToAnalyze=100) shrinks chunk size
// down to ~6, meaning ~34 separate *start* calls for a 202-account batch. One-at-a-time, each
// costing a real HTTP round-trip to Apify, was the dominant cause (alongside a DB N+1 fixed
// separately) of a real production 504: starting a run is a single cheap POST that returns
// almost immediately, there's no reason many of them can't fire together. Bounded at 8
// concurrent rather than unbounded, out of courtesy to Apify's API rather than any limit
// that's actually been hit (their own maxConcurrentActorJobs is 128, confirmed via
// /users/me/limits on this account).
const RUN_START_CONCURRENCY = 8;

async function startOneRun(
  batchId: string,
  platform: ScoutPlatform,
  actorId: string,
  input: Record<string, unknown>,
  handleCount: number,
  maxChargeUsd: number,
  timeoutSecs: number,
  actorFactors: Record<string, unknown>,
  weights: { engagement: number; reach: number; consistency: number; contentMix: number },
): Promise<boolean> {
  try {
    const run = await runActor(actorId, input, { maxChargeUsd, timeoutSecs });
    await prisma.scoutRun.create({
      data: {
        batchId,
        platform,
        actorId,
        apifyRunId: run.runId,
        datasetId: run.datasetId,
        status: "running",
        handleCount,
        actorFactors: actorFactors as object,
        weightEngagement: weights.engagement,
        weightReach: weights.reach,
        weightConsistency: weights.consistency,
        weightContentMix: weights.contentMix,
      },
    });
    return true;
  } catch (err) {
    // One chunk failing to *start* shouldn't block the rest — log it as a run row so it's
    // visible in the batch's status rather than only in server logs.
    await prisma.scoutRun.create({
      data: {
        batchId,
        platform,
        actorId,
        apifyRunId: "",
        datasetId: "",
        status: "error",
        handleCount,
        actorFactors: actorFactors as object,
        weightEngagement: weights.engagement,
        weightReach: weights.reach,
        weightConsistency: weights.consistency,
        weightContentMix: weights.contentMix,
        error: err instanceof Error ? err.message : String(err),
        finishedAt: new Date(),
      },
    });
    return false;
  }
}

async function runInBatches<T>(items: T[], concurrency: number, fn: (item: T) => Promise<boolean>) {
  let started = 0;
  let failed = 0;
  for (let i = 0; i < items.length; i += concurrency) {
    const results = await Promise.all(items.slice(i, i + concurrency).map(fn));
    for (const ok of results) ok ? started++ : failed++;
  }
  return { runsStarted: started, runsFailed: failed };
}

async function startInstagramRuns(
  batchId: string,
  handles: string[],
  timeoutMultiplier: number,
): Promise<{ runsStarted: number; runsFailed: number }> {
  const settings = await getScoutSettings("instagram");
  const chunkSize = igChunkSize(settings.postsToAnalyze!);
  const chunks = chunk(handles, chunkSize);
  const actorFactors: Record<string, unknown> = {
    postsToAnalyze: settings.postsToAnalyze,
    postTypeFilter: settings.postTypeFilter,
    skipPinnedPosts: settings.skipPinnedPosts,
  };
  if (settings.dateFilter) actorFactors.dateFilter = settings.dateFilter;
  const weights = {
    engagement: settings.weightEngagement,
    reach: settings.weightReach,
    consistency: settings.weightConsistency,
    contentMix: settings.weightContentMix,
  };

  return runInBatches(chunks, RUN_START_CONCURRENCY, (handleChunk) =>
    startOneRun(
      batchId,
      "instagram",
      INSTAGRAM_ACTOR_ID,
      { profiles: handleChunk, ...actorFactors },
      handleChunk.length,
      igMaxChargeUsd(handleChunk.length, settings.postsToAnalyze!),
      igTimeoutSecs(handleChunk.length, settings.postsToAnalyze!) * timeoutMultiplier,
      actorFactors,
      weights,
    ),
  );
}

async function startFacebookRuns(
  batchId: string,
  handles: string[],
  timeoutMultiplier: number,
): Promise<{ runsStarted: number; runsFailed: number }> {
  const settings = await getScoutSettings("facebook");
  const chunks = chunk(handles, FB_CHUNK_SIZE);
  const weights = {
    engagement: settings.weightEngagement,
    reach: settings.weightReach,
    consistency: settings.weightConsistency,
    contentMix: settings.weightContentMix,
  };

  return runInBatches(chunks, RUN_START_CONCURRENCY, (handleChunk) =>
    startOneRun(
      batchId,
      "facebook",
      FACEBOOK_ACTOR_ID,
      { startUrls: handleChunk.map((h) => ({ url: `https://www.facebook.com/${h}` })) },
      handleChunk.length,
      fbMaxChargeUsd(handleChunk.length),
      fbTimeoutSecs(handleChunk.length) * timeoutMultiplier,
      {},
      weights,
    ),
  );
}

/**
 * Kicks off one Apify run per chunk of the batch's candidates, per platform (a batch can
 * hold both). Returns immediately per run.
 */
export async function startScoutRuns(batchId: string): Promise<{ runsStarted: number; runsFailed: number }> {
  const entries = await prisma.scoutBatchEntry.findMany({ where: { batchId }, include: { candidate: true } });
  const igHandles = entries.filter((e) => e.candidate.platform === "instagram").map((e) => e.candidate.handle);
  const fbHandles = entries.filter((e) => e.candidate.platform === "facebook").map((e) => e.candidate.handle);

  const [ig, fb] = await Promise.all([
    igHandles.length > 0 ? startInstagramRuns(batchId, igHandles, 1) : { runsStarted: 0, runsFailed: 0 },
    fbHandles.length > 0 ? startFacebookRuns(batchId, fbHandles, 1) : { runsStarted: 0, runsFailed: 0 },
  ]);
  return { runsStarted: ig.runsStarted + fb.runsStarted, runsFailed: ig.runsFailed + fb.runsFailed };
}

/**
 * Re-scans every candidate in this batch that never got a snapshot from one of its own runs
 * — a chunk that TIMED-OUT or otherwise errored leaves its accounts with nothing, and
 * without this they'd sit on the leaderboard forever as "scan in progress" once the batch's
 * other runs are all terminal. Uses a longer timeout than the original attempt.
 */
export async function retryMissingScoutCandidates(
  batchId: string,
): Promise<{ retried: number; runsStarted: number; runsFailed: number }> {
  // Guards against a real race, not just a UI nicety (the batch page only shows the retry
  // button once every run is terminal, but this function is reachable directly via its
  // route regardless) — a candidate with no snapshot yet might just belong to a chunk
  // that's still running, not one that actually failed. Retrying it here would kick off a
  // second, redundant Apify run for handles already being (successfully) scanned.
  const stillRunning = await prisma.scoutRun.count({ where: { batchId, status: { in: ["queued", "running"] } } });
  if (stillRunning > 0) {
    throw new Error(`${stillRunning} run(s) in this batch are still in progress — wait for them to finish before retrying`);
  }

  const runIds = (await prisma.scoutRun.findMany({ where: { batchId }, select: { id: true } })).map((r) => r.id);
  const entries = await prisma.scoutBatchEntry.findMany({
    where: { batchId },
    include: { candidate: { include: { snapshots: { where: { runId: { in: runIds } }, take: 1 } } } },
  });
  const missing = entries.filter((e) => e.candidate.snapshots.length === 0);
  if (missing.length === 0) return { retried: 0, runsStarted: 0, runsFailed: 0 };

  const igHandles = missing.filter((e) => e.candidate.platform === "instagram").map((e) => e.candidate.handle);
  const fbHandles = missing.filter((e) => e.candidate.platform === "facebook").map((e) => e.candidate.handle);
  const [ig, fb] = await Promise.all([
    igHandles.length > 0
      ? startInstagramRuns(batchId, igHandles, RETRY_TIMEOUT_MULTIPLIER)
      : { runsStarted: 0, runsFailed: 0 },
    fbHandles.length > 0
      ? startFacebookRuns(batchId, fbHandles, RETRY_TIMEOUT_MULTIPLIER)
      : { runsStarted: 0, runsFailed: 0 },
  ]);
  return { retried: missing.length, runsStarted: ig.runsStarted + fb.runsStarted, runsFailed: ig.runsFailed + fb.runsFailed };
}

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);

async function ingestInstagramItem(
  raw: Record<string, unknown>,
  runId: string,
  weights: { engagement: number; reach: number; consistency: number; contentMix: number },
): Promise<boolean> {
  const normalized = normalizeScoutItem(raw);
  if (!normalized.profileUsername) return false; // unattributable row — nothing to link it to
  const key = profileUrlKey(normalized.profileUsername, "instagram");
  const candidate = await prisma.scoutCandidate.findUnique({ where: { profileUrlKey: key } });
  if (!candidate) return false; // shouldn't happen (we only ever send handles we stored), skip defensively

  const score = scoreInfluencer(
    {
      followersAvailable: normalized.followersAvailable,
      followers: normalized.followers,
      engagementRatePct: normalized.engagementRatePct,
      consistencyScore01: normalized.consistencyScore01,
      contentMixClipsPct: normalized.contentMixClipsPct,
    },
    weights,
  );

  const snapshot = await prisma.scoutSnapshot.create({
    data: {
      candidateId: candidate.id,
      runId,
      followers: normalized.followers,
      followersAvailable: normalized.followersAvailable,
      postsAnalyzed: normalized.postsAnalyzed,
      engagementRatePct: normalized.engagementRatePct,
      commentRatePct: normalized.commentRatePct,
      consistencyScore: normalized.consistencyScore01,
      postingFrequencyPerWeek: normalized.postingFrequencyPerWeek,
      contentMixClipsPct: normalized.contentMixClipsPct,
      contentMixCarouselPct: normalized.contentMixCarouselPct,
      contentMixImagePct: normalized.contentMixImagePct,
      mostEngagedPostUrl: normalized.mostEngagedPostUrl,
      note: normalized.note,
      raw: normalized.raw as object,
    },
  });
  await prisma.scoutScore.create({
    data: {
      snapshotId: snapshot.id,
      buzzFactor: score.buzzFactor,
      reachScore: score.components.reach,
      engagementScore: score.components.engagement,
      consistencyScore: score.components.consistency,
      contentMixScore: score.components.contentMix,
    },
  });
  return true;
}

async function ingestFacebookItem(
  raw: Record<string, unknown>,
  runId: string,
  weights: { engagement: number; reach: number; consistency: number; contentMix: number },
): Promise<boolean> {
  const normalized = normalizeFacebookScoutItem(raw);
  if (!normalized.pageUsername) return false;
  const key = profileUrlKey(normalized.pageUsername, "facebook");
  const candidate = await prisma.scoutCandidate.findUnique({ where: { profileUrlKey: key } });
  if (!candidate) return false;

  // No post-level data at all (page-only scan) — engagementRatePct is a proxy from
  // Facebook's own "talking about this" figure, not a likes/comments-based rate; consistency
  // and content-mix are always null here and get excluded from scoring, not faked.
  const engagementRatePct =
    normalized.talkingAbout !== null && normalized.followers
      ? (normalized.talkingAbout / normalized.followers) * 100
      : null;

  const score = scoreInfluencer(
    {
      followersAvailable: normalized.followersAvailable,
      followers: normalized.followers,
      engagementRatePct,
      consistencyScore01: null,
      contentMixClipsPct: null,
    },
    weights,
  );

  const snapshot = await prisma.scoutSnapshot.create({
    data: {
      candidateId: candidate.id,
      runId,
      followers: normalized.followers,
      followersAvailable: normalized.followersAvailable,
      postsAnalyzed: 0,
      engagementRatePct,
      note: normalized.note,
      raw: normalized.raw as object,
    },
  });
  await prisma.scoutScore.create({
    data: {
      snapshotId: snapshot.id,
      buzzFactor: score.buzzFactor,
      reachScore: score.components.reach,
      engagementScore: score.components.engagement,
      consistencyScore: score.components.consistency,
      contentMixScore: score.components.contentMix,
    },
  });
  return true;
}

/**
 * Cron entry point — checks every non-terminal ScoutRun, ingests any that finished. Never
 * waits on a run itself (that's what orphaned the client.ts comment-scrape runs); a run
 * still going just gets checked again on the next tick.
 */
export async function pollAndIngestScoutRuns(): Promise<{ checked: number; ingested: number; errored: number }> {
  const pending = await prisma.scoutRun.findMany({ where: { status: { in: ["queued", "running"] } } });
  let ingested = 0;
  let errored = 0;

  for (const run of pending) {
    if (!run.apifyRunId) continue; // failed-to-start rows are already terminal (status "error")
    try {
      const status = await getRunStatus(run.apifyRunId);
      if (!TERMINAL.has(status.status)) continue;

      // Read the dataset regardless of terminal status, not only on SUCCEEDED — confirmed
      // live (2026-08-18) that a TIMED-OUT run had already written 43 items ($0.37 already
      // spent) that an old "SUCCEEDED-only" read would have silently discarded, forcing a
      // full re-scan of every handle in that chunk at 2x cost. Apify writes dataset items
      // incrementally as each profile finishes, so a run that dies partway through still has
      // real, already-paid-for results worth keeping. Marked "error" below (not "done")
      // whenever the status wasn't a clean SUCCEEDED, so retryMissingScoutCandidates still
      // picks up whichever handles in this chunk didn't make it into the dataset — just no
      // longer re-scanning ones that did.
      const items = await getDatasetItems<Record<string, unknown>>(status.datasetId);
      const weights = {
        engagement: run.weightEngagement,
        reach: run.weightReach,
        consistency: run.weightConsistency,
        contentMix: run.weightContentMix,
      };
      const ingestItem = run.platform === "facebook" ? ingestFacebookItem : ingestInstagramItem;
      for (const raw of items) {
        await ingestItem(raw, run.id, weights);
      }

      if (status.status === "SUCCEEDED") {
        await prisma.scoutRun.update({ where: { id: run.id }, data: { status: "done", finishedAt: new Date() } });
        ingested++;
      } else {
        // Still "error" (not "done") even though items may have been salvaged above — the
        // run itself didn't finish cleanly, and any handle in this chunk that never made it
        // into the dataset needs the retry path, not to be silently treated as complete.
        await prisma.scoutRun.update({
          where: { id: run.id },
          data: {
            status: "error",
            error: `Apify run ended ${status.status} — salvaged ${items.length} item(s) from its dataset before marking it errored`,
            finishedAt: new Date(),
          },
        });
        errored++;
      }
    } catch (err) {
      // A poll/ingest failure on one run must not block the others in this tick.
      console.error(`Scoutline: failed to ingest run ${run.id}:`, err);
    }
  }

  return { checked: pending.length, ingested, errored };
}

export interface ScoutLeaderboardRow {
  candidateId: string;
  platform: ScoutPlatform;
  handle: string;
  suppliedName: string | null;
  deliverable: string | null;
  rowNumber: number | null;
  buzzFactor: number | null;
  components: { reach: number | null; engagement: number | null; consistency: number | null; contentMix: number | null } | null;
  followers: number | null;
  engagementRatePct: number | null;
  postsAnalyzed: number | null;
  note: string | null;
  scrapedAt: Date | null;
}

/** Latest snapshot+score per candidate in a batch, ranked by buzz factor descending. */
export async function getScoutLeaderboard(batchId: string): Promise<ScoutLeaderboardRow[]> {
  const entries = await prisma.scoutBatchEntry.findMany({
    where: { batchId },
    include: {
      candidate: {
        include: {
          snapshots: {
            orderBy: { scrapedAt: "desc" },
            take: 1,
            include: { score: true },
          },
        },
      },
    },
  });

  const rows: ScoutLeaderboardRow[] = entries.map((e) => {
    const snapshot = e.candidate.snapshots[0] ?? null;
    return {
      candidateId: e.candidateId,
      platform: e.candidate.platform,
      handle: e.candidate.handle,
      suppliedName: e.suppliedName,
      deliverable: e.deliverable,
      rowNumber: e.rowNumber,
      buzzFactor: snapshot?.score?.buzzFactor ?? null,
      components: snapshot?.score
        ? {
            reach: snapshot.score.reachScore,
            engagement: snapshot.score.engagementScore,
            consistency: snapshot.score.consistencyScore,
            contentMix: snapshot.score.contentMixScore,
          }
        : null,
      followers: snapshot?.followers ?? null,
      engagementRatePct: snapshot?.engagementRatePct ?? null,
      postsAnalyzed: snapshot?.postsAnalyzed ?? null,
      note: snapshot?.note ?? null,
      scrapedAt: snapshot?.scrapedAt ?? null,
    };
  });

  // Unscored accounts (run still in flight) sort after everything ranked, newest-row-first
  // among themselves so the leaderboard doesn't look randomly ordered while a batch is
  // still filling in.
  return rows.sort((a, b) => {
    if (a.buzzFactor === null && b.buzzFactor === null) return (a.rowNumber ?? 0) - (b.rowNumber ?? 0);
    if (a.buzzFactor === null) return 1;
    if (b.buzzFactor === null) return -1;
    return b.buzzFactor - a.buzzFactor;
  });
}

export interface ScoutRawRow {
  platform: ScoutPlatform;
  handle: string;
  suppliedName: string | null;
  deliverable: string | null;
  buzzFactor: number | null;
  followers: number | null;
  followersAvailable: boolean | null;
  postsAnalyzed: number | null;
  engagementRatePct: number | null;
  commentRatePct: number | null;
  consistencyScore: number | null;
  postingFrequencyPerWeek: number | null;
  contentMixClipsPct: number | null;
  contentMixCarouselPct: number | null;
  contentMixImagePct: number | null;
  mostEngagedPostUrl: string | null;
  note: string | null;
  scrapedAt: Date | null;
}

/** Every raw field from each candidate's latest snapshot — the "view the underlying data,
 * not just the score" option, for the batch page's table view and CSV export. */
export async function getScoutRawRows(batchId: string): Promise<ScoutRawRow[]> {
  const entries = await prisma.scoutBatchEntry.findMany({
    where: { batchId },
    include: {
      candidate: {
        include: { snapshots: { orderBy: { scrapedAt: "desc" }, take: 1, include: { score: true } } },
      },
    },
  });

  return entries.map((e) => {
    const s = e.candidate.snapshots[0] ?? null;
    return {
      platform: e.candidate.platform,
      handle: e.candidate.handle,
      suppliedName: e.suppliedName,
      deliverable: e.deliverable,
      buzzFactor: s?.score?.buzzFactor ?? null,
      followers: s?.followers ?? null,
      followersAvailable: s?.followersAvailable ?? null,
      postsAnalyzed: s?.postsAnalyzed ?? null,
      engagementRatePct: s?.engagementRatePct ?? null,
      commentRatePct: s?.commentRatePct ?? null,
      consistencyScore: s?.consistencyScore ?? null,
      postingFrequencyPerWeek: s?.postingFrequencyPerWeek ?? null,
      contentMixClipsPct: s?.contentMixClipsPct ?? null,
      contentMixCarouselPct: s?.contentMixCarouselPct ?? null,
      contentMixImagePct: s?.contentMixImagePct ?? null,
      mostEngagedPostUrl: s?.mostEngagedPostUrl ?? null,
      note: s?.note ?? null,
      scrapedAt: s?.scrapedAt ?? null,
    };
  });
}

export interface ScoutBatchSummary {
  id: string;
  fileName: string;
  sourceType: string;
  expectedCount: number;
  parsedCount: number;
  createdAt: Date;
  archivedAt: Date | null;
  runsTotal: number;
  runsDone: number;
  runsErrored: number;
  scoredCount: number;
}

function summarizeBatch(b: {
  id: string;
  fileName: string;
  sourceType: string;
  expectedCount: number;
  parsedCount: number;
  createdAt: Date;
  archivedAt: Date | null;
  runs: { status: string }[];
  entries: { candidate: { snapshots: unknown[] } }[];
}): ScoutBatchSummary {
  return {
    id: b.id,
    fileName: b.fileName,
    sourceType: b.sourceType,
    expectedCount: b.expectedCount,
    parsedCount: b.parsedCount,
    createdAt: b.createdAt,
    archivedAt: b.archivedAt,
    runsTotal: b.runs.length,
    runsDone: b.runs.filter((r) => r.status === "done").length,
    runsErrored: b.runs.filter((r) => r.status === "error").length,
    scoredCount: b.entries.filter((e) => e.candidate.snapshots.length > 0).length,
  };
}

const BATCH_SUMMARY_INCLUDE = {
  runs: true,
  entries: { include: { candidate: { include: { snapshots: { take: 1, orderBy: { scrapedAt: "desc" as const } } } } } },
};

// Fetched directly by id (not filtered through listScoutBatches' archived-exclusion) — a
// direct link to an archived batch (e.g. from a bookmark, or before someone archived it)
// should still open, it just won't show up in the default list anymore.
export async function getScoutBatch(batchId: string): Promise<ScoutBatchSummary | null> {
  const batch = await prisma.scoutBatch.findUnique({ where: { id: batchId }, include: BATCH_SUMMARY_INCLUDE });
  return batch ? summarizeBatch(batch) : null;
}

export async function listScoutBatches(includeArchived = false): Promise<ScoutBatchSummary[]> {
  const batches = await prisma.scoutBatch.findMany({
    where: includeArchived ? {} : { archivedAt: null },
    orderBy: { createdAt: "desc" },
    include: BATCH_SUMMARY_INCLUDE,
  });
  return batches.map(summarizeBatch);
}

/** Soft delete — see ScoutBatch.archivedAt's schema comment for why this isn't a hard delete. */
export async function setScoutBatchArchived(batchId: string, archived: boolean): Promise<void> {
  await prisma.scoutBatch.update({ where: { id: batchId }, data: { archivedAt: archived ? new Date() : null } });
}

/**
 * Re-scores a batch's existing snapshots against the *current* Buzz Factor weights — no new
 * Apify run, no new cost. Distinct from the "actor factors are frozen per run, never
 * retroactively changed" guarantee elsewhere in this file: that guarantee is about what got
 * scraped (real money to redo), not about how already-scraped numbers get combined into a
 * score. Re-weighting stored data with a better-calibrated formula is exactly what this is
 * for — an explicit, opt-in action (never automatic on a settings save), so a batch's
 * leaderboard only changes when someone deliberately asks it to. Each candidate is
 * re-weighted using *its own platform's* current settings — a mixed-platform batch doesn't
 * get one global weight set applied to everyone.
 */
export async function recomputeScoutScores(batchId: string): Promise<{ rescored: number }> {
  const [igSettings, fbSettings] = await Promise.all([getScoutSettings("instagram"), getScoutSettings("facebook")]);
  const weightsByPlatform: Record<ScoutPlatform, { engagement: number; reach: number; consistency: number; contentMix: number }> = {
    instagram: {
      engagement: igSettings.weightEngagement,
      reach: igSettings.weightReach,
      consistency: igSettings.weightConsistency,
      contentMix: igSettings.weightContentMix,
    },
    facebook: {
      engagement: fbSettings.weightEngagement,
      reach: fbSettings.weightReach,
      consistency: fbSettings.weightConsistency,
      contentMix: fbSettings.weightContentMix,
    },
  };

  const entries = await prisma.scoutBatchEntry.findMany({
    where: { batchId },
    include: { candidate: { include: { snapshots: { orderBy: { scrapedAt: "desc" }, take: 1 } } } },
  });

  let rescored = 0;
  for (const entry of entries) {
    const snapshot = entry.candidate.snapshots[0];
    if (!snapshot) continue;

    const score = scoreInfluencer(
      {
        followersAvailable: snapshot.followersAvailable,
        followers: snapshot.followers,
        engagementRatePct: snapshot.engagementRatePct,
        consistencyScore01: snapshot.consistencyScore,
        contentMixClipsPct: snapshot.contentMixClipsPct,
      },
      weightsByPlatform[entry.candidate.platform],
    );

    await prisma.scoutScore.upsert({
      where: { snapshotId: snapshot.id },
      create: {
        snapshotId: snapshot.id,
        buzzFactor: score.buzzFactor,
        reachScore: score.components.reach,
        engagementScore: score.components.engagement,
        consistencyScore: score.components.consistency,
        contentMixScore: score.components.contentMix,
      },
      update: {
        buzzFactor: score.buzzFactor,
        reachScore: score.components.reach,
        engagementScore: score.components.engagement,
        consistencyScore: score.components.consistency,
        contentMixScore: score.components.contentMix,
        computedAt: new Date(),
      },
    });
    rescored++;
  }

  return { rescored };
}

export interface ScoutBatchComparison {
  batch: ScoutBatchSummary;
  avgBuzzFactor: number | null;
  topAccounts: { handle: string; buzzFactor: number }[];
}

/** Side-by-side summary stats for 2-4 batches — not a merge, each batch's own numbers. */
export async function getScoutBatchCompareData(batchIds: string[]): Promise<ScoutBatchComparison[]> {
  const results: ScoutBatchComparison[] = [];
  for (const batchId of batchIds) {
    const batch = await getScoutBatch(batchId);
    if (!batch) continue;
    const rows = await getScoutLeaderboard(batchId);
    const scored = rows.filter((r) => r.buzzFactor !== null);
    const avgBuzzFactor =
      scored.length > 0 ? Math.round(scored.reduce((sum, r) => sum + (r.buzzFactor ?? 0), 0) / scored.length) : null;
    results.push({
      batch,
      avgBuzzFactor,
      topAccounts: scored.slice(0, 5).map((r) => ({ handle: r.handle, buzzFactor: r.buzzFactor! })),
    });
  }
  return results;
}
