// Scoutline's editable scan factors — the easy_scraper actor's own input parameters plus
// the Buzz Factor weights, exposed from a settings panel so tuning them doesn't need a
// redeploy. Singleton row (see ScoutSettings' schema comment) — read/updated in place,
// snapshotted onto each ScoutBatch at creation so a later settings change never retroactively
// changes an already-started scan's parameters or scores.
import { prisma } from "@/lib/prisma";

const SETTINGS_ID = "default";

export interface ScoutSettingsValue {
  postsToAnalyze: number;
  postTypeFilter: string;
  skipPinnedPosts: boolean;
  dateFilter: string | null;
  weightEngagement: number;
  weightReach: number;
  weightConsistency: number;
  weightContentMix: number;
}

export async function getScoutSettings(): Promise<ScoutSettingsValue> {
  // upsert-on-read rather than a migration seed: guarantees exactly one row exists without
  // a separate seed step, and every field already has a schema-level @default matching the
  // very first real batch's actual parameters (see ScoutBatch's own migration comment).
  const row = await prisma.scoutSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID },
    update: {},
  });
  return {
    postsToAnalyze: row.postsToAnalyze,
    postTypeFilter: row.postTypeFilter,
    skipPinnedPosts: row.skipPinnedPosts,
    dateFilter: row.dateFilter,
    weightEngagement: row.weightEngagement,
    weightReach: row.weightReach,
    weightConsistency: row.weightConsistency,
    weightContentMix: row.weightContentMix,
  };
}

const POST_TYPE_FILTERS = new Set(["all", "feed", "clips", "carousel_container"]);

function clampPositiveInt(n: unknown, fallback: number, max: number): number {
  const v = typeof n === "number" ? Math.round(n) : Number(n);
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.min(v, max);
}

function clampWeight(n: unknown, fallback: number): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v) || v < 0) return fallback;
  return Math.min(v, 1);
}

/** Validates + persists a full settings update. Throws on a genuinely bad value rather than
 * silently clamping it away — a caller-visible 400, not a scan that starts with a value
 * nobody chose. */
export async function updateScoutSettings(input: Partial<ScoutSettingsValue>): Promise<ScoutSettingsValue> {
  const current = await getScoutSettings();
  const next: ScoutSettingsValue = { ...current, ...input };

  if (!POST_TYPE_FILTERS.has(next.postTypeFilter)) {
    throw new Error(`postTypeFilter must be one of ${[...POST_TYPE_FILTERS].join(", ")}`);
  }
  next.postsToAnalyze = clampPositiveInt(next.postsToAnalyze, current.postsToAnalyze, 100);
  next.weightEngagement = clampWeight(next.weightEngagement, current.weightEngagement);
  next.weightReach = clampWeight(next.weightReach, current.weightReach);
  next.weightConsistency = clampWeight(next.weightConsistency, current.weightConsistency);
  next.weightContentMix = clampWeight(next.weightContentMix, current.weightContentMix);
  if (next.weightEngagement + next.weightReach + next.weightConsistency + next.weightContentMix <= 0) {
    throw new Error("at least one weight must be greater than 0");
  }

  await prisma.scoutSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, ...next },
    update: next,
  });
  return next;
}
