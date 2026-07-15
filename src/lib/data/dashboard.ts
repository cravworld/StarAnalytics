import { getInstagramInsightsProvider } from "@/lib/providers";
import { TOP_POSTS_MONTH } from "@/lib/providers/seed";

export async function getDashboardData() {
  const insights = await getInstagramInsightsProvider().getAccountInsights();
  return { insights, topPosts: TOP_POSTS_MONTH };
}
