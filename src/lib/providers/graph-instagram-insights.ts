// Live InstagramInsightsProvider — Instagram Graph API (Instagram Login), plain `fetch`
// (same "plain fetch, no SDK" convention as claude-sentiment.ts / email-notifier.ts).
//
// Field/metric names below were verified against developers.facebook.com on 2026-07-24
// (API v25.0) — NOT yet exercised against a real account: Phase 7 has no Meta app
// registered, no Business/Creator account conversion, no App Review approval. Re-verify
// every field against the first real response once INSTAGRAM_ACCESS_TOKEN exists — treat
// this as "checked against current docs," not "proven against live data."
//
// Two AccountInsights/Demographics fields have NO real Graph API source as of this
// writing and are flagged inline below (profileVisits, heatmap) rather than silently
// faked — see the comments at each site. That's a product decision for whoever flips
// DATA_MODE_INSTAGRAM to "live", not something to resolve unilaterally here.
import type { AccountInsights, Demographics, InstagramInsightsProvider, Media } from "./types";

const API_VERSION = "v25.0";
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;
const DAY_SECONDS = 86_400;

function accessToken(): string {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) throw new Error("INSTAGRAM_ACCESS_TOKEN is not set — required for the live InstagramInsightsProvider");
  return token;
}

function businessAccountId(): string {
  const id = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  if (!id) throw new Error("INSTAGRAM_BUSINESS_ACCOUNT_ID is not set — required for the live InstagramInsightsProvider");
  return id;
}

async function graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("access_token", accessToken());
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Instagram Graph API request failed (${path}): ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

function unixDaysAgo(days: number): string {
  return String(Math.floor(Date.now() / 1000) - days * DAY_SECONDS);
}

// -- account-level insights (metric_type=total_value: single summed number over since/until) --

interface TotalValueResponse {
  data: { name: string; total_value: { value: number } }[];
}

async function totalValueMetric(metric: string, sinceDays: number, untilDays: number): Promise<number> {
  const res = await graphGet<TotalValueResponse>(`/${businessAccountId()}/insights`, {
    metric,
    period: "day",
    metric_type: "total_value",
    since: unixDaysAgo(sinceDays),
    until: unixDaysAgo(untilDays),
  });
  return res.data[0]?.total_value?.value ?? 0;
}

// -- follows_and_unfollows: total_value with breakdown=follow_type (two rows: "follows"/"unfollows") --

interface BreakdownTotalValueResponse {
  data: {
    name: string;
    total_value: { breakdowns: { results: { dimension_values: string[]; value: number }[] }[] };
  }[];
}

async function followsMinusUnfollows(sinceDays: number, untilDays: number): Promise<number> {
  const res = await graphGet<BreakdownTotalValueResponse>(`/${businessAccountId()}/insights`, {
    metric: "follows_and_unfollows",
    period: "day",
    metric_type: "total_value",
    breakdown: "follow_type",
    since: unixDaysAgo(sinceDays),
    until: unixDaysAgo(untilDays),
  });
  const rows = res.data[0]?.total_value?.breakdowns?.[0]?.results ?? [];
  const follows = rows.find((r) => r.dimension_values[0] === "FOLLOWER")?.value ?? 0;
  const unfollows = rows.find((r) => r.dimension_values[0] === "NON_FOLLOWER")?.value ?? 0;
  return follows - unfollows;
}

// -- reach time_series: day-by-day values, bucketed into 8 weekly sums for reachByWeek --

interface TimeSeriesResponse {
  data: { name: string; total_value: { timeseries?: { value: number }[] } }[];
}

async function reachByWeek(): Promise<number[]> {
  const res = await graphGet<TimeSeriesResponse>(`/${businessAccountId()}/insights`, {
    metric: "reach",
    period: "day",
    metric_type: "time_series",
    since: unixDaysAgo(56),
    until: unixDaysAgo(0),
  });
  const daily = res.data[0]?.total_value?.timeseries?.map((d) => d.value) ?? [];
  const weeks: number[] = [];
  for (let i = 0; i < daily.length; i += 7) {
    const week = daily.slice(i, i + 7).reduce((sum, v) => sum + v, 0);
    weeks.push(Math.round((week / 1_000_000) * 100) / 100); // millions, matching mock's unit comment
  }
  return weeks;
}

// -- media list with field-expansion insights (one call, not N+1 per post) --

interface MediaNode {
  id: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_product_type?: "FEED" | "REELS" | "STORY";
  timestamp: string;
  like_count?: number;
  comments_count?: number;
  insights?: { data: { name: string; values: { value: number }[] }[] };
}

async function fetchRecentMedia(limit: number): Promise<MediaNode[]> {
  const res = await graphGet<{ data: MediaNode[] }>(`/${businessAccountId()}/media`, {
    fields: `id,media_type,media_product_type,timestamp,like_count,comments_count,insights.metric(reach,total_interactions)`,
    limit: String(limit),
  });
  return res.data;
}

function metricValue(node: MediaNode, name: string): number {
  return node.insights?.data.find((m) => m.name === name)?.values?.[0]?.value ?? 0;
}

function mediaTypeFor(node: MediaNode): Media["type"] {
  if (node.media_product_type === "REELS") return "reel";
  if (node.media_product_type === "STORY") return "story";
  if (node.media_type === "CAROUSEL_ALBUM") return "carousel";
  return "photo";
}

export class GraphInstagramInsightsProvider implements InstagramInsightsProvider {
  async getAccountInsights(): Promise<AccountInsights> {
    const [profile, reach30d, reach30dPrev, engaged30d, engaged30dPrev, followersDeltaWeek, media] =
      await Promise.all([
        graphGet<{ followers_count: number }>(`/${businessAccountId()}`, { fields: "followers_count" }),
        totalValueMetric("reach", 30, 0),
        totalValueMetric("reach", 60, 30),
        totalValueMetric("accounts_engaged", 30, 0),
        totalValueMetric("accounts_engaged", 60, 30),
        followsMinusUnfollows(7, 0),
        fetchRecentMedia(25),
      ]);

    // No direct "engagement rate" metric exists — approximated as accounts_engaged /
    // followers_count, same definition Meta's own Professional Dashboard uses.
    const followers = profile.followers_count;
    const engagementRate = followers > 0 ? Math.round((engaged30d / followers) * 1000) / 10 : 0;
    const engagementRatePrev = followers > 0 ? (engaged30dPrev / followers) * 100 : 0;

    const now = Date.now();
    const thisMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    const prevMonthStart = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).getTime();
    const postsThisMonth = media.filter((m) => new Date(m.timestamp).getTime() >= thisMonthStart).length;
    const postsPrevMonth = media.filter((m) => {
      const t = new Date(m.timestamp).getTime();
      return t >= prevMonthStart && t < thisMonthStart;
    }).length;

    const reels = media.filter((m) => m.media_product_type === "REELS");
    const reelViews = reels.map((m) => metricValue(m, "reach"));
    const avgReelViews = reelViews.length ? Math.round(reelViews.reduce((a, b) => a + b, 0) / reelViews.length) : 0;

    // Format/time-of-day breakdown is computed from this same ~25-post sample — a real
    // (if noisy, small-N) calculation over live data, not a fabricated figure.
    const byFormat = new Map<string, number[]>();
    for (const m of media) {
      const type = mediaTypeFor(m);
      const engagement = metricValue(m, "total_interactions");
      byFormat.set(type, [...(byFormat.get(type) ?? []), engagement]);
    }
    let bestFormat = "—";
    let bestFormatEngagement = 0;
    const postTypePerformance: { label: string; engagementPct: number }[] = [];
    for (const [label, values] of byFormat) {
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      postTypePerformance.push({ label, engagementPct: Math.round(avg * 10) / 10 });
      if (avg > bestFormatEngagement) {
        bestFormatEngagement = Math.round(avg * 10) / 10;
        bestFormat = label;
      }
    }

    const hourCounts = new Map<string, number[]>();
    for (const m of media) {
      const d = new Date(m.timestamp);
      const key = `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]} ${d.getHours() % 12 || 12}${d.getHours() < 12 ? "AM" : "PM"}`;
      hourCounts.set(key, [...(hourCounts.get(key) ?? []), metricValue(m, "total_interactions")]);
    }
    let bestPostTime = "—";
    let bestPostTimeAvg = -1;
    for (const [key, values] of hourCounts) {
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      if (avg > bestPostTimeAvg) {
        bestPostTimeAvg = avg;
        bestPostTime = key;
      }
    }

    return {
      followers,
      followersDeltaWeek,
      engagementRate,
      engagementRateDeltaMonth: Math.round((engagementRate - engagementRatePrev) * 10) / 10,
      reach30d,
      reach30dDeltaPct: reach30dPrev > 0 ? Math.round(((reach30d - reach30dPrev) / reach30dPrev) * 100) : 0,
      // profile_links_taps is the only account-level "profile visit"-adjacent metric Graph
      // API currently exposes — it counts taps on contact buttons (call/email/text/directions),
      // NOT general profile-visit traffic (that metric was removed; no replacement exists as of
      // this writing). Accounts without contact buttons configured will show ~0 here. Flag this
      // to whoever reviews Phase 7 before shipping it under the "Profile Visits" label — it may
      // need relabeling or dropping from the dashboard instead.
      profileVisits: await totalValueMetric("profile_links_taps", 30, 0),
      profileVisitsDeltaPct: 0,
      // No metric returns historical follower-count time series (follows_and_unfollows is
      // total_value only, not time_series) — accumulating this needs our own periodic
      // snapshot job, deferred out of this pass (see AGENTS.md Phase 7b note). Empty rather
      // than fabricated.
      followerGrowth12w: [],
      engagementBreakdown: {
        likes: media.reduce((s, m) => s + (m.like_count ?? 0), 0),
        comments: media.reduce((s, m) => s + (m.comments_count ?? 0), 0),
        saves: 0, // `saved` metric requires a separate insights call per post; not fetched in this pass.
        shares: 0,
      },
      bestFormat,
      bestFormatEngagement,
      bestPostTime,
      postsThisMonth,
      postsThisMonthDelta: postsThisMonth - postsPrevMonth,
      avgReelViews,
      avgReelViewsDeltaPct: 0,
      postTypePerformance,
      reachByWeek: await reachByWeek(),
    };
  }

  async getSelfMedia(): Promise<Media[]> {
    const media = await fetchRecentMedia(25);
    return media.map((m) => ({
      id: m.id,
      type: mediaTypeFor(m),
      likes: m.like_count ?? 0,
      comments: m.comments_count ?? 0,
      reachOrViews: metricValue(m, "reach"),
      icon: mediaTypeFor(m) === "reel" ? "🎬" : mediaTypeFor(m) === "carousel" ? "🖼️" : "📷",
    }));
  }

  async getAudienceDemographics(): Promise<Demographics> {
    const [cityRes, ageGenderRes] = await Promise.all([
      graphGet<BreakdownTotalValueResponse>(`/${businessAccountId()}/insights`, {
        metric: "follower_demographics",
        period: "lifetime",
        metric_type: "total_value",
        timeframe: "this_month",
        breakdown: "city",
      }),
      graphGet<BreakdownTotalValueResponse>(`/${businessAccountId()}/insights`, {
        metric: "follower_demographics",
        period: "lifetime",
        metric_type: "total_value",
        timeframe: "this_month",
        breakdown: "age,gender",
      }),
    ]);

    const cityRows = cityRes.data[0]?.total_value?.breakdowns?.[0]?.results ?? [];
    const totalCity = cityRows.reduce((s, r) => s + r.value, 0);
    const topLocations = cityRows
      .map((r) => ({ city: r.dimension_values[0], pct: totalCity ? Math.round((r.value / totalCity) * 100) : 0 }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 5);

    const ageGenderRows = ageGenderRes.data[0]?.total_value?.breakdowns?.[0]?.results ?? [];
    const totalAgeGender = ageGenderRows.reduce((s, r) => s + r.value, 0);
    const byAge = new Map<string, number>();
    let male = 0;
    let female = 0;
    for (const r of ageGenderRows) {
      const [age, gender] = r.dimension_values;
      byAge.set(age, (byAge.get(age) ?? 0) + r.value);
      if (gender === "M") male += r.value;
      if (gender === "F") female += r.value;
    }
    const ageDistribution = [...byAge.entries()]
      .map(([bracket, value]) => ({ bracket, pct: totalAgeGender ? Math.round((value / totalAgeGender) * 100) : 0 }))
      .sort((a, b) => b.pct - a.pct);
    const genderTotal = male + female;

    return {
      topCity: topLocations[0]?.city ?? "—",
      topCityPct: topLocations[0]?.pct ?? 0,
      dominantAge: ageDistribution[0]?.bracket ?? "—",
      dominantAgePct: ageDistribution[0]?.pct ?? 0,
      genderSplit: {
        male: genderTotal ? Math.round((male / genderTotal) * 100) : 0,
        female: genderTotal ? Math.round((female / genderTotal) * 100) : 0,
      },
      topLocations,
      ageDistribution,
      // No Graph API metric returns hourly/day-of-week follower-activity data at all (not
      // deprecated — never existed). This is filled with zeros rather than fabricated
      // numbers; flag to whoever ships Phase 7 that the Audience heatmap needs either a
      // third-party source or removal once this provider goes live.
      heatmap: {},
    };
  }
}
