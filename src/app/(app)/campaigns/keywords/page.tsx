import { getKeywordTrends } from "@/lib/data/keywords";
import { KeywordTrendsList } from "@/components/campaigns/KeywordTrendsList";

export default async function KeywordTrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string }>;
}) {
  const { campaign } = await searchParams;
  const data = await getKeywordTrends(campaign || undefined);
  return <KeywordTrendsList data={data} />;
}
