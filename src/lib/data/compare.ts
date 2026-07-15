import { getPublicContentProvider } from "@/lib/providers";
import { COMPARE_METRICS } from "@/lib/providers/seed";

export async function getCompareData() {
  // Competitor snapshot is fetched via PublicContentProvider (Apify, everyone-else data).
  // Story Response Rate is Graph-API-only and never available for another account —
  // seed data marks it `otherPrivate: true` so the UI renders "—" instead of a blank.
  const competitor = await getPublicContentProvider().scrapeByHandle("@dqsalmaan");
  return {
    self: { name: "Nivin Pauly", handle: "@nivinpauly", followers: "7.4M" },
    other: { name: "Dulquer Salmaan", handle: "@dqsalmaan", followers: "9.1M" },
    competitorSnapshot: competitor,
    metrics: COMPARE_METRICS,
  };
}
