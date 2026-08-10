import { getCampaignCompareOptions, getCampaignCompareData, getCampaignCompareDataAtDay } from "@/lib/data/campaigns";
import { CampaignCompareClient } from "@/components/campaigns/CampaignCompareClient";

const MAX_DAY_N = 3650; // ~10 years — generous ceiling against a typo'd huge number, not a real limit

export default async function CampaignComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string; dayN?: string }>;
}) {
  const { ids, dayN: dayNParam } = await searchParams;
  const options = await getCampaignCompareOptions();
  // Default to every campaign when none is selected yet — with only a handful of campaigns
  // typically tracked at once, comparing "all" is a reasonable starting view.
  const selectedIds = ids ? ids.split(",").filter(Boolean) : options.map((o) => o.id);

  // Mode switch via URL param, same pattern as the campaign filter on /campaigns/keywords —
  // present and valid means "day-N cohort" mode, absent or invalid falls back to the normal
  // current-totals comparison rather than erroring on a malformed query string.
  const parsedDayN = dayNParam ? Number(dayNParam) : NaN;
  const dayN = Number.isInteger(parsedDayN) && parsedDayN > 0 && parsedDayN <= MAX_DAY_N ? parsedDayN : null;

  if (dayN !== null) {
    const dayNResult = await getCampaignCompareDataAtDay(selectedIds, dayN);
    return <CampaignCompareClient options={options} selectedIds={selectedIds} dayNResult={dayNResult} />;
  }

  const { columns, rows } = await getCampaignCompareData(selectedIds);
  return <CampaignCompareClient options={options} selectedIds={selectedIds} columns={columns} rows={rows} />;
}
