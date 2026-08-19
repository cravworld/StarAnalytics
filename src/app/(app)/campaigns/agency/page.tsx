import { getAgencyUploadData } from "@/lib/data/agency";
import { AgencyReportClient } from "@/components/agency/AgencyReportClient";

// Server Actions on this page read this for their timeout (the docs' guidance
// for Server Actions: set maxDuration at the page level). analyseAgencyPostsAction
// itself returns almost instantly (the batch job runs in after()), but the
// after() callback's own lifetime is still bounded by this route's duration —
// raised here so a multi-batch Apify run has room to finish. If the deployed
// plan clamps this lower, the batch job already updates scrape_runs
// incrementally, so a truncated run still reports honest partial progress
// rather than vanishing silently.
//
// 800s (Vercel Pro's generally-available ceiling), not 300s. At 300s this route was
// structurally unable to finish its own after() job: a post-scrape batch plus the comment
// scrapes queued behind it exceed 5 minutes, so the function was killed mid-wait — which
// is worse than slow, because the Apify runs it had started kept billing with nobody left
// to read their datasets, and the scrape_runs rows stayed "running" forever. The wait
// budgets in apify-public-content.ts are now sized to fit inside this number.
export const maxDuration = 800;

export default async function AgencyReportPage() {
  const { agencies } = await getAgencyUploadData();
  return <AgencyReportClient agencies={agencies} />;
}
