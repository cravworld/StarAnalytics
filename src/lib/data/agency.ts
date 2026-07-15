import { getPublicContentProvider } from "@/lib/providers";
import { AGENCIES, AUTH_FLAGS, POSITIVE_SIGNALS, POSTS } from "@/lib/providers/seed";

export async function getAgencyUploadData() {
  return { agencies: AGENCIES };
}

export async function runAgencyAnalysis() {
  // In Phase 3 this enqueues a real Apify batch run over the uploaded URLs and
  // scores each post with the deterministic scorePost() function. For Phase 0
  // the "Analyse All Posts" action reads the same seeded scores.
  await getPublicContentProvider().scrapeByUrls(POSTS.map((p) => p.url));
  return {
    agencies: AGENCIES,
    posts: POSTS,
    authFlags: AUTH_FLAGS,
    positiveSignals: POSITIVE_SIGNALS,
    summary: {
      postsAnalysed: 500,
      totalReach: "84.2M",
      avgEngagement: "4.8%",
      authenticityPct: 71,
      flaggedAgencies: 3,
      topAgency: AGENCIES[0],
      avgAuthenticity: 71,
      avgPerformance: 78,
      avgEfficiency: 74,
    },
  };
}
