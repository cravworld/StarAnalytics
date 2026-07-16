import { prisma } from "@/lib/prisma";
import type { ThresholdConfigParams } from "./types";

// The velocity cutoffs look aggressive (z > 1 is "medium") for a plain
// z-score, but that's deliberate: the cohort they're scored against includes
// the fraudulent posts themselves, which pulls the mean/stddev toward them
// and mathematically caps how large a genuine outlier's z-score can reach
// (see the derivation and empirical tuning in scorePost.test.ts's
// cross-agency ranking test, run against src/lib/providers/seed.ts's
// realistic ~30%-contaminated proportions). A textbook z > 3 cutoff would
// never fire under this kind of contamination.
export const DEFAULT_THRESHOLD_PARAMS: ThresholdConfigParams = {
  weights: { performance: 0.5, authenticity: 0.3, efficiency: 0.2 },
  velocityZCutoffMedium: 1,
  velocityZCutoffHigh: 1.3,
  velocityPenaltyPerZ: 65,
  offHoursStartIst: 2,
  offHoursEndIst: 4,
  offHoursSeverity: "medium",
};

// Every agency_post_scores row stamps the version returned here. Re-tuning
// means inserting a new ThresholdConfig row with an incremented version —
// never mutating an existing one — so a later re-tune can't retroactively
// change what an already-scored row's version means. No settings UI this
// phase (spec allows direct DB edit as the fallback); this is the versioning
// mechanism that fallback still needs to respect.
export async function getActiveThresholdConfig(): Promise<{ version: number; params: ThresholdConfigParams }> {
  const latest = await prisma.thresholdConfig.findFirst({ orderBy: { version: "desc" } });
  if (latest) return { version: latest.version, params: latest.params as unknown as ThresholdConfigParams };

  const created = await prisma.thresholdConfig.create({
    data: { version: 1, params: DEFAULT_THRESHOLD_PARAMS as object },
  });
  return { version: created.version, params: DEFAULT_THRESHOLD_PARAMS };
}
