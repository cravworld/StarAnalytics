import { getInstagramInsightsProvider } from "@/lib/providers";
import { RECENT_POSTS } from "@/lib/providers/seed";

export async function getContentData() {
  const insights = await getInstagramInsightsProvider().getAccountInsights();
  return { insights, recentPosts: RECENT_POSTS };
}
