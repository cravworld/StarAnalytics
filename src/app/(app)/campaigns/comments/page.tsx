import { getCommentSentimentInsights } from "@/lib/data/commentSentimentInsights";
import { CommentSentimentView } from "@/components/campaigns/CommentSentimentView";

export default async function CommentSentimentPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string }>;
}) {
  const { campaign } = await searchParams;
  const data = await getCommentSentimentInsights(campaign || undefined);
  return <CommentSentimentView data={data} />;
}
