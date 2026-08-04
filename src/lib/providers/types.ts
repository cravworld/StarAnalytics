// Provider seam — screens/components must depend only on these interfaces
// (or the query layer in src/lib/data), never on Apify/Graph API/LLM SDKs directly.

export interface AccountInsights {
  followers: number;
  followersDeltaWeek: number;
  engagementRate: number;
  engagementRateDeltaMonth: number;
  reach30d: number;
  reach30dDeltaPct: number;
  profileVisits: number;
  profileVisitsDeltaPct: number;
  followerGrowth12w: number[]; // 12 weekly follower counts (thousands)
  engagementBreakdown: { likes: number; comments: number; saves: number; shares: number };
  bestFormat: string;
  bestFormatEngagement: number;
  bestPostTime: string;
  postsThisMonth: number;
  postsThisMonthDelta: number;
  avgReelViews: number;
  avgReelViewsDeltaPct: number;
  postTypePerformance: { label: string; engagementPct: number }[];
  reachByWeek: number[]; // millions, 8 weeks
}

export interface Media {
  id: string;
  type: "reel" | "photo" | "carousel" | "story";
  likes: number;
  comments: number;
  reachOrViews: number;
  icon: string;
}

export interface Demographics {
  topCity: string;
  topCityPct: number;
  dominantAge: string;
  dominantAgePct: number;
  genderSplit: { male: number; female: number };
  topLocations: { city: string; pct: number }[];
  ageDistribution: { bracket: string; pct: number }[];
  heatmap: Record<string, number[]>; // day -> 6 time-slot intensities (0-4)
}

// Nivin's own first-party data only.
export interface InstagramInsightsProvider {
  getAccountInsights(): Promise<AccountInsights>;
  getSelfMedia(): Promise<Media[]>;
  getAudienceDemographics(): Promise<Demographics>;
}

// Decoupled from Prisma's generated Platform enum on purpose — this seam shouldn't import
// generated client types, same reasoning as `source` below being a literal union rather
// than the PostSource Prisma enum.
export type PlatformId = "instagram" | "youtube";

export interface RawPost {
  id: string;
  source: "self" | "competitor" | "agency" | "fanpage" | "campaign";
  platform: PlatformId;
  igShortcode: string;
  externalUrl: string;
  authorHandle: string;
  mediaType: string;
  caption: string;
  postedAt: string;
  reach: number | null;
  likes: number;
  comments: number;
  saves: number | null;
  shares: number | null;
  raw: Record<string, unknown>;
}

export interface AccountSnapshot {
  handle: string;
  displayName: string;
  followers: number;
  avgLikesPerPost: number;
  postsPerWeek: number;
  reelAvgViews: number;
  engagementRateEstimate: number;
  // Story response rate is a Graph-API-only insight; never available for a non-owned account.
  storyResponseRate: number | null;
}

// Everyone else — hashtags, agency posts, fan pages, competitors — via Apify.
export interface PublicContentProvider {
  scrapeByHashtag(tag: string): Promise<RawPost[]>;
  scrapeByHandle(handle: string): Promise<AccountSnapshot & { posts: RawPost[] }>;
  scrapeByUrls(urls: string[]): Promise<RawPost[]>;
}

export interface SentimentResult {
  id: string;
  label: "pos" | "neu" | "neg";
  score: number;
  keywords: string[];
  // Which model actually produced this specific result. Added when a cross-provider
  // fallback chain (Claude -> OpenAI -> Gemini) was introduced: different results in the
  // same batch/call can now genuinely come from different providers if an earlier one
  // failed (rate limit, exhausted credits, etc.), so a single call-level model string is no
  // longer accurate — this must be stamped per result, not assumed from which provider was
  // requested.
  model: string;
}

export interface SentimentProvider {
  classify(posts: { id: string; text: string }[]): Promise<SentimentResult[]>;
}

export interface Alert {
  id: string;
  type: string;
  message: string;
  createdAt: string;
}

export interface NotifierProvider {
  send(alert: Alert): Promise<void>;
}

export type DataMode = "mock" | "live";
