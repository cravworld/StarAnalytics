// Scoutline's editable scan factors — the Instagram actor's own input parameters (Facebook
// has none; see below) plus the Buzz Factor weights, exposed from a settings panel so tuning
// them doesn't need a redeploy. One row per platform (see ScoutSettings' schema comment) —
// read/updated in place, snapshotted onto each ScoutRun at start time so a later settings
// change never retroactively changes an already-started scan's parameters or scores.
import { prisma } from "@/lib/prisma";
import type { ScoutPlatform } from "@prisma/client";

export interface InstagramSettingsValue {
  postsToAnalyze: number;
  postTypeFilter: string;
  skipPinnedPosts: boolean;
  dateFilter: string | null;
}

// Facebook is deliberately page-only (2026-08-18 direction) — apify/facebook-pages-scraper
// takes no configurable factors beyond the URL itself, so there's nothing to expose here.
// Kept as a (currently empty) type rather than omitted entirely so a future factor has an
// obvious place to go without restructuring the settings shape again.
export type FacebookSettingsValue = Record<string, never>;

export interface ScoutWeights {
  weightEngagement: number;
  weightReach: number;
  weightConsistency: number;
  weightContentMix: number;
}

export type ScoutSettingsValue = ScoutWeights & Partial<InstagramSettingsValue>;

// First-guess defaults — Instagram's were retuned against real data (see scoreInfluencer.ts);
// Facebook's are the same starting split Instagram itself began at, pending a real batch to
// tune against.
const DEFAULTS: Record<ScoutPlatform, ScoutSettingsValue> = {
  instagram: {
    postsToAnalyze: 100,
    postTypeFilter: "all",
    skipPinnedPosts: true,
    dateFilter: null,
    weightEngagement: 0.45,
    weightReach: 0.3,
    weightConsistency: 0.05,
    weightContentMix: 0.2,
  },
  facebook: {
    weightEngagement: 0.4,
    weightReach: 0.3,
    weightConsistency: 0.15,
    weightContentMix: 0.15,
  },
};

export async function getScoutSettings(platform: ScoutPlatform): Promise<ScoutSettingsValue> {
  const defaults = DEFAULTS[platform];
  const row = await prisma.scoutSettings.upsert({
    where: { platform },
    create: {
      platform,
      igPostsToAnalyze: defaults.postsToAnalyze,
      igPostTypeFilter: defaults.postTypeFilter,
      igSkipPinnedPosts: defaults.skipPinnedPosts,
      igDateFilter: defaults.dateFilter,
      weightEngagement: defaults.weightEngagement,
      weightReach: defaults.weightReach,
      weightConsistency: defaults.weightConsistency,
      weightContentMix: defaults.weightContentMix,
    },
    update: {},
  });

  if (platform === "instagram") {
    return {
      postsToAnalyze: row.igPostsToAnalyze ?? defaults.postsToAnalyze,
      postTypeFilter: row.igPostTypeFilter ?? defaults.postTypeFilter,
      skipPinnedPosts: row.igSkipPinnedPosts ?? defaults.skipPinnedPosts,
      dateFilter: row.igDateFilter,
      weightEngagement: row.weightEngagement,
      weightReach: row.weightReach,
      weightConsistency: row.weightConsistency,
      weightContentMix: row.weightContentMix,
    };
  }
  return {
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

/** Validates + persists a full settings update for one platform. Throws on a genuinely bad
 * value rather than silently clamping it away — a caller-visible 400, not a scan that
 * starts with a value nobody chose. */
export async function updateScoutSettings(
  platform: ScoutPlatform,
  input: Partial<ScoutSettingsValue>,
): Promise<ScoutSettingsValue> {
  const current = await getScoutSettings(platform);
  const next: ScoutSettingsValue = { ...current, ...input };

  if (platform === "instagram") {
    const ig = next as InstagramSettingsValue;
    if (!POST_TYPE_FILTERS.has(ig.postTypeFilter)) {
      throw new Error(`postTypeFilter must be one of ${[...POST_TYPE_FILTERS].join(", ")}`);
    }
    ig.postsToAnalyze = clampPositiveInt(ig.postsToAnalyze, (current as InstagramSettingsValue).postsToAnalyze, 100);
  }
  next.weightEngagement = clampWeight(next.weightEngagement, current.weightEngagement);
  next.weightReach = clampWeight(next.weightReach, current.weightReach);
  next.weightConsistency = clampWeight(next.weightConsistency, current.weightConsistency);
  next.weightContentMix = clampWeight(next.weightContentMix, current.weightContentMix);
  if (next.weightEngagement + next.weightReach + next.weightConsistency + next.weightContentMix <= 0) {
    throw new Error("at least one weight must be greater than 0");
  }

  const ig = next as Partial<InstagramSettingsValue>;
  await prisma.scoutSettings.upsert({
    where: { platform },
    create: {
      platform,
      igPostsToAnalyze: ig.postsToAnalyze,
      igPostTypeFilter: ig.postTypeFilter,
      igSkipPinnedPosts: ig.skipPinnedPosts,
      igDateFilter: ig.dateFilter,
      weightEngagement: next.weightEngagement,
      weightReach: next.weightReach,
      weightConsistency: next.weightConsistency,
      weightContentMix: next.weightContentMix,
    },
    update: {
      igPostsToAnalyze: ig.postsToAnalyze,
      igPostTypeFilter: ig.postTypeFilter,
      igSkipPinnedPosts: ig.skipPinnedPosts,
      igDateFilter: ig.dateFilter,
      weightEngagement: next.weightEngagement,
      weightReach: next.weightReach,
      weightConsistency: next.weightConsistency,
      weightContentMix: next.weightContentMix,
    },
  });
  return next;
}
