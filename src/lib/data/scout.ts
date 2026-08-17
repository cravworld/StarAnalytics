// Scoutline orchestration: upload -> batch/candidates persisted -> Apify run(s) kicked off
// and tracked in ScoutRun -> a cron ingests finished runs into ScoutSnapshot/ScoutScore.
//
// Deliberately asynchronous end-to-end (see client.ts's own warning: a route killed
// mid-wait orphans a billed, unread Apify run). createScoutBatch + startScoutRuns return
// as soon as the run is *started*, not finished — src/app/api/cron/poll-scout-runs/route.ts
// does the waiting.
import { getDatasetItems, getRunStatus, runActor } from "@/lib/apify/client";
import { normalizeScoutItem } from "@/lib/providers/apify-scout-normalize";
import { prisma } from "@/lib/prisma";
import { scoreInfluencer } from "@/lib/scoring/scoreInfluencer";
import { getScoutSettings } from "@/lib/data/scoutSettings";
import { profileUrlKey, type ParsedCandidate } from "@/lib/scout/ingest";

// 2026-08-17 direction: this single actor is the whole pipeline for now — no profile/post/
// comment-scraper pass, no authenticity component. Overridable so a future environment (or
// a switch back to a different actor) doesn't need a code change.
export const SCOUT_ACTOR_ID = process.env.APIFY_ACTOR_SCOUT || "easy_scraper/instagram-profile-engagement-analytics";

// Chunk size and per-run timeout both scale with postsToAnalyze — a fixed 40-handle chunk
// was sized around a 15-posts-per-account baseline (confirmed live: ~0.9s of actor runtime
// per profile-post analyzed). At postsToAnalyze=100 that same 40-handle chunk would run
// ~6.7x longer than the 600s timeout it was tuned for — confirmed the hard way on the first
// real batch, where even the 15-post baseline timed out once on ordinary proxy variance.
// Keeping "handles x postsToAnalyze" roughly constant across settings keeps both the
// per-chunk wall-clock and the blast radius of one bad chunk stable regardless of how deep
// a scan is configured to go.
const TARGET_CHUNK_WORK_UNITS = 40 * 15;
const SECONDS_PER_WORK_UNIT = 2; // ~2.2x the observed ~0.9s/unit, as margin against a slow run

function computeChunkSize(postsToAnalyze: number): number {
  return Math.max(1, Math.min(40, Math.floor(TARGET_CHUNK_WORK_UNITS / postsToAnalyze)));
}

function estimateTimeoutSecs(handleCount: number, postsToAnalyze: number): number {
  return Math.max(300, Math.ceil(handleCount * postsToAnalyze * SECONDS_PER_WORK_UNIT));
}

// $0.0006/post analyzed (confirmed via a live run's pricingInfo) + $0.0001/dataset item +
// a fixed $0.001 actor-start charge. 50% headroom over the arithmetic max for a chunk since
// analysis cost is bounded above by chunkSize x postsToAnalyze regardless of how active the
// real accounts are — there's no "per-URL multiplies unboundedly" risk here the way the
// comment-scraper has (see client.ts's own warning about that actor).
function chunkMaxChargeUsd(handleCount: number, postsToAnalyze: number): number {
  const arithmeticMax = handleCount * postsToAnalyze * 0.0006 + handleCount * 0.0001 + 0.001;
  return Math.ceil(arithmeticMax * 1.5 * 100) / 100;
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

/**
 * Persists the batch + deduped candidates + per-batch entries. Does not start any Apify run.
 * Snapshots the *current* ScoutSettings onto the batch row (see its schema comment) — a
 * settings change after this point never reaches back into an already-created batch.
 */
export async function createScoutBatch(
  fileName: string,
  sourceType: "pdf" | "excel" | "manual",
  rowsFound: number,
  candidates: ParsedCandidate[],
): Promise<CreateBatchResult> {
  const settings = await getScoutSettings();
  const batch = await prisma.scoutBatch.create({
    data: {
      fileName,
      sourceType,
      expectedCount: rowsFound,
      parsedCount: candidates.length,
      postsToAnalyze: settings.postsToAnalyze,
      postTypeFilter: settings.postTypeFilter,
      skipPinnedPosts: settings.skipPinnedPosts,
      dateFilter: settings.dateFilter,
      weightEngagement: settings.weightEngagement,
      weightReach: settings.weightReach,
      weightConsistency: settings.weightConsistency,
      weightContentMix: settings.weightContentMix,
    },
  });

  for (const c of candidates) {
    const candidate = await prisma.scoutCandidate.upsert({
      where: { profileUrlKey: c.handle },
      create: { igHandle: c.handle, profileUrlKey: c.handle },
      update: {},
    });
    await prisma.scoutBatchEntry.upsert({
      where: { batchId_candidateId: { batchId: batch.id, candidateId: candidate.id } },
      create: {
        batchId: batch.id,
        candidateId: candidate.id,
        rowNumber: c.rowNumber,
        suppliedName: c.name,
        deliverable: c.deliverable,
      },
      update: { rowNumber: c.rowNumber, suppliedName: c.name, deliverable: c.deliverable },
    });
  }

  return { batchId: batch.id, expectedCount: rowsFound, parsedCount: candidates.length };
}

/**
 * Kicks off one Apify run per chunk of the batch's candidates, using the actor factors this
 * batch was snapshotted with at creation time (never "whatever settings are current now").
 * Returns immediately per run.
 */
export async function startScoutRuns(batchId: string): Promise<{ runsStarted: number; runsFailed: number }> {
  const batch = await prisma.scoutBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new Error(`ScoutBatch ${batchId} not found`);

  const entries = await prisma.scoutBatchEntry.findMany({
    where: { batchId },
    include: { candidate: true },
  });
  const handles = entries.map((e) => e.candidate.igHandle);
  return startRunsForHandles(batchId, batch, handles, 1);
}

// A chunk that hit its timeout (proxy/rate variance, not a cost or code issue — confirmed
// on the very first real batch: 1 of 6 identically-sized chunks timed out while the other 5
// succeeded at the same settings) gets a longer window on retry rather than the same one
// again.
const RETRY_TIMEOUT_MULTIPLIER = 2;

async function startRunsForHandles(
  batchId: string,
  batch: { postsToAnalyze: number; postTypeFilter: string; skipPinnedPosts: boolean; dateFilter: string | null },
  handles: string[],
  timeoutMultiplier: number,
): Promise<{ runsStarted: number; runsFailed: number }> {
  const chunkSize = computeChunkSize(batch.postsToAnalyze);
  const chunks = chunk(handles, chunkSize);
  const actorInput: Record<string, unknown> = {
    postsToAnalyze: batch.postsToAnalyze,
    postTypeFilter: batch.postTypeFilter,
    skipPinnedPosts: batch.skipPinnedPosts,
  };
  if (batch.dateFilter) actorInput.dateFilter = batch.dateFilter;

  let runsStarted = 0;
  let runsFailed = 0;
  for (const handleChunk of chunks) {
    try {
      const maxChargeUsd = chunkMaxChargeUsd(handleChunk.length, batch.postsToAnalyze);
      const timeoutSecs = estimateTimeoutSecs(handleChunk.length, batch.postsToAnalyze) * timeoutMultiplier;
      const run = await runActor(
        SCOUT_ACTOR_ID,
        { profiles: handleChunk, ...actorInput },
        { maxChargeUsd, timeoutSecs },
      );
      await prisma.scoutRun.create({
        data: {
          batchId,
          actorId: SCOUT_ACTOR_ID,
          apifyRunId: run.runId,
          datasetId: run.datasetId,
          status: "running",
          handleCount: handleChunk.length,
        },
      });
      runsStarted++;
    } catch (err) {
      // One chunk failing to *start* shouldn't block the rest — log it as a run row so
      // it's visible in the batch's status rather than only in server logs.
      await prisma.scoutRun.create({
        data: {
          batchId,
          actorId: SCOUT_ACTOR_ID,
          apifyRunId: "",
          datasetId: "",
          status: "error",
          handleCount: handleChunk.length,
          error: err instanceof Error ? err.message : String(err),
          finishedAt: new Date(),
        },
      });
      runsFailed++;
    }
  }
  return { runsStarted, runsFailed };
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
  const batch = await prisma.scoutBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new Error(`ScoutBatch ${batchId} not found`);

  const entries = await prisma.scoutBatchEntry.findMany({
    where: { batchId },
    include: { candidate: { include: { snapshots: { where: { runId: { in: await runIdsForBatch(batchId) } }, take: 1 } } } },
  });
  const missing = entries.filter((e) => e.candidate.snapshots.length === 0);
  if (missing.length === 0) return { retried: 0, runsStarted: 0, runsFailed: 0 };

  const { runsStarted, runsFailed } = await startRunsForHandles(
    batchId,
    batch,
    missing.map((e) => e.candidate.igHandle),
    RETRY_TIMEOUT_MULTIPLIER,
  );
  return { retried: missing.length, runsStarted, runsFailed };
}

async function runIdsForBatch(batchId: string): Promise<string[]> {
  const runs = await prisma.scoutRun.findMany({ where: { batchId }, select: { id: true } });
  return runs.map((r) => r.id);
}

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);

/**
 * Cron entry point — checks every non-terminal ScoutRun, ingests any that finished. Never
 * waits on a run itself (that's what orphaned the client.ts comment-scrape runs); a run
 * still going just gets checked again on the next tick.
 */
export async function pollAndIngestScoutRuns(): Promise<{ checked: number; ingested: number; errored: number }> {
  const pending = await prisma.scoutRun.findMany({
    where: { status: { in: ["queued", "running"] } },
    include: { batch: true },
  });
  let ingested = 0;
  let errored = 0;

  for (const run of pending) {
    if (!run.apifyRunId) continue; // failed-to-start rows are already terminal (status "error")
    try {
      const status = await getRunStatus(run.apifyRunId);
      if (!TERMINAL.has(status.status)) continue;

      if (status.status !== "SUCCEEDED") {
        await prisma.scoutRun.update({
          where: { id: run.id },
          data: { status: "error", error: `Apify run ended ${status.status}`, finishedAt: new Date() },
        });
        errored++;
        continue;
      }

      const items = await getDatasetItems<Record<string, unknown>>(status.datasetId);
      for (const raw of items) {
        const normalized = normalizeScoutItem(raw);
        if (!normalized.profileUsername) continue; // unattributable row — nothing to link it to
        const key = profileUrlKey(normalized.profileUsername);
        const candidate = await prisma.scoutCandidate.findUnique({ where: { profileUrlKey: key } });
        if (!candidate) continue; // shouldn't happen (we only ever send handles we stored), skip defensively

        const score = scoreInfluencer(
          {
            followersAvailable: normalized.followersAvailable,
            followers: normalized.followers,
            engagementRatePct: normalized.engagementRatePct,
            consistencyScore01: normalized.consistencyScore01,
            contentMixClipsPct: normalized.contentMixClipsPct,
          },
          {
            engagement: run.batch.weightEngagement,
            reach: run.batch.weightReach,
            consistency: run.batch.weightConsistency,
            contentMix: run.batch.weightContentMix,
          },
        );

        const snapshot = await prisma.scoutSnapshot.create({
          data: {
            candidateId: candidate.id,
            runId: run.id,
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
      }

      await prisma.scoutRun.update({
        where: { id: run.id },
        data: { status: "done", finishedAt: new Date() },
      });
      ingested++;
    } catch (err) {
      // A poll/ingest failure on one run must not block the others in this tick.
      console.error(`Scoutline: failed to ingest run ${run.id}:`, err);
    }
  }

  return { checked: pending.length, ingested, errored };
}

export interface ScoutLeaderboardRow {
  candidateId: string;
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
      handle: e.candidate.igHandle,
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
      handle: e.candidate.igHandle,
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
  runsTotal: number;
  runsDone: number;
  runsErrored: number;
  scoredCount: number;
}

export async function getScoutBatch(batchId: string): Promise<ScoutBatchSummary | null> {
  const all = await listScoutBatches();
  return all.find((b) => b.id === batchId) ?? null;
}

export async function listScoutBatches(): Promise<ScoutBatchSummary[]> {
  const batches = await prisma.scoutBatch.findMany({
    orderBy: { createdAt: "desc" },
    include: { runs: true, entries: { include: { candidate: { include: { snapshots: { take: 1, orderBy: { scrapedAt: "desc" } } } } } } },
  });

  return batches.map((b) => ({
    id: b.id,
    fileName: b.fileName,
    sourceType: b.sourceType,
    expectedCount: b.expectedCount,
    parsedCount: b.parsedCount,
    createdAt: b.createdAt,
    runsTotal: b.runs.length,
    runsDone: b.runs.filter((r) => r.status === "done").length,
    runsErrored: b.runs.filter((r) => r.status === "error").length,
    scoredCount: b.entries.filter((e) => e.candidate.snapshots.length > 0).length,
  }));
}

/**
 * Re-scores a batch's existing snapshots against the *current* Buzz Factor weights — no new
 * Apify run, no new cost. Distinct from the "actor factors are frozen per batch, never
 * retroactively changed" guarantee elsewhere in this file: that guarantee is about what got
 * scraped (postsToAnalyze etc, which would need real money to redo), not about how already-
 * scraped numbers get combined into a score. Re-weighting stored data with a better-
 * calibrated formula is exactly what this is for — an explicit, opt-in action (never
 * automatic on a settings save), so a batch's leaderboard only changes when someone
 * deliberately asks it to. Updates the batch's own weight snapshot afterward so it stays an
 * honest record of what its current scores were actually computed with.
 */
export async function recomputeScoutScores(batchId: string): Promise<{ rescored: number }> {
  const batch = await prisma.scoutBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new Error(`ScoutBatch ${batchId} not found`);

  const settings = await getScoutSettings();
  const weights = {
    engagement: settings.weightEngagement,
    reach: settings.weightReach,
    consistency: settings.weightConsistency,
    contentMix: settings.weightContentMix,
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
      weights,
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

  await prisma.scoutBatch.update({
    where: { id: batchId },
    data: {
      weightEngagement: weights.engagement,
      weightReach: weights.reach,
      weightConsistency: weights.consistency,
      weightContentMix: weights.contentMix,
    },
  });

  return { rescored };
}
