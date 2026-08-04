import { getCampaignCompareOptions, getCampaignCompareData } from "@/lib/data/campaigns";
import { CampaignCompareClient } from "@/components/campaigns/CampaignCompareClient";

export default async function CampaignComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids } = await searchParams;
  const options = await getCampaignCompareOptions();
  // Default to every campaign when none is selected yet — with only a handful of campaigns
  // typically tracked at once, comparing "all" is a reasonable starting view.
  const selectedIds = ids ? ids.split(",").filter(Boolean) : options.map((o) => o.id);
  const { columns, rows } = await getCampaignCompareData(selectedIds);

  return <CampaignCompareClient options={options} selectedIds={selectedIds} columns={columns} rows={rows} />;
}
