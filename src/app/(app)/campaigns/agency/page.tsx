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
export const maxDuration = 300;

export default async function AgencyReportPage() {
  const { agencies } = await getAgencyUploadData();
  return <AgencyReportClient agencies={agencies} />;
}
