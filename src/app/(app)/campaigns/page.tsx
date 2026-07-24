import { getOwnCampaigns } from "@/lib/data/campaigns";
import { OwnCampaignsList } from "@/components/campaigns/OwnCampaignsList";

export default async function OwnCampaignsPage() {
  const { campaigns, kpis } = await getOwnCampaigns();
  return <OwnCampaignsList campaigns={campaigns} kpis={kpis} />;
}
