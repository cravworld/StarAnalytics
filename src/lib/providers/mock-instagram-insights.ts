import type { AccountInsights, Demographics, InstagramInsightsProvider, Media } from "./types";
import {
  AGE_DISTRIBUTION,
  ENGAGEMENT_BREAKDOWN,
  FOLLOWER_GROWTH_12W,
  HEAT_DATA,
  POST_TYPE_PERFORMANCE,
  REACH_BY_WEEK,
  RECENT_POSTS,
  TOP_LOCATIONS,
} from "./seed";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class MockInstagramInsightsProvider implements InstagramInsightsProvider {
  async getAccountInsights(): Promise<AccountInsights> {
    await delay(80);
    return {
      followers: 7_400_000,
      followersDeltaWeek: 12_400,
      engagementRate: 4.2,
      engagementRateDeltaMonth: 0.3,
      reach30d: 28_100_000,
      reach30dDeltaPct: -4,
      profileVisits: 312_000,
      profileVisitsDeltaPct: 22,
      followerGrowth12w: FOLLOWER_GROWTH_12W,
      engagementBreakdown: ENGAGEMENT_BREAKDOWN,
      bestFormat: "Reels",
      bestFormatEngagement: 4.8,
      bestPostTime: "Fri 7PM",
      postsThisMonth: 14,
      postsThisMonthDelta: 3,
      avgReelViews: 2_800_000,
      avgReelViewsDeltaPct: 18,
      postTypePerformance: POST_TYPE_PERFORMANCE,
      reachByWeek: REACH_BY_WEEK,
    };
  }

  async getSelfMedia(): Promise<Media[]> {
    await delay(80);
    return RECENT_POSTS.map((p, i) => ({
      id: `self-media-${i}`,
      type: p.icon === "🎬" ? "reel" : p.icon === "🖼️" ? "carousel" : "photo",
      likes: 0,
      comments: 0,
      reachOrViews: 0,
      icon: p.icon,
    }));
  }

  async getAudienceDemographics(): Promise<Demographics> {
    await delay(80);
    return {
      topCity: "Kochi",
      topCityPct: 31,
      dominantAge: "25–34",
      dominantAgePct: 44,
      genderSplit: { male: 64, female: 36 },
      topLocations: TOP_LOCATIONS,
      ageDistribution: AGE_DISTRIBUTION,
      heatmap: HEAT_DATA,
    };
  }
}
