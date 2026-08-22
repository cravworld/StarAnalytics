import { notFound } from "next/navigation";
import { getCampaignTracking } from "@/lib/data/trackedPosts";
import { AddTrackedPostForm } from "@/components/tracking/AddTrackedPostForm";
import { RefreshTrackedPostsButton } from "@/components/tracking/RefreshTrackedPostsButton";
import { TrackedPostsView } from "@/components/tracking/TrackedPostsView";

// Vercel applies the hosting page's maxDuration to the Server Actions invoked from it, and
// to their after() callbacks — see
// node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md §Duration.
// Without this, both of this page's slow paths ran under the project default: ingest, where
// every new account costs an inline Apify profile scrape, and the page-discovery and refresh
// passes, which were deferred with after() precisely BECAUSE they are "well past the request
// budget" — and were then handed the smallest budget on offer. Same fix as the fan-pages page.
//
// This is a ceiling, not the fix. A long paste outruns 800s too, which is why
// AddTrackedPostForm submits one link per request rather than the whole box.
export const maxDuration = 800;

// params is a Promise in this version of Next — see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md.
export default async function TrackerCampaignPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;
  const data = await getCampaignTracking(campaignId);
  if (!data) notFound();

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>{data.campaign.name}</h1>
        <RefreshTrackedPostsButton campaignId={campaignId} />
      </div>

      <AddTrackedPostForm campaignId={campaignId} />
      <TrackedPostsView data={data} />
    </>
  );
}
