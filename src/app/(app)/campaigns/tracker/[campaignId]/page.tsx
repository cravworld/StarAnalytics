import { notFound } from "next/navigation";
import { getCampaignTracking } from "@/lib/data/trackedPosts";
import { AddTrackedPostForm } from "@/components/tracking/AddTrackedPostForm";
import { RefreshTrackedPostsButton } from "@/components/tracking/RefreshTrackedPostsButton";
import { TrackedPostsView } from "@/components/tracking/TrackedPostsView";

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
