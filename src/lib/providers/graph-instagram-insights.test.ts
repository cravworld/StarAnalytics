// Pure parsing test — mocks `fetch` with response shapes copied from developers.facebook.com
// (v25.0) rather than a live account, since Phase 7 has no Meta app/token yet. This is the
// substitute for real verification: it locks down how total_value/breakdowns/time_series
// get walked, so a real token later proves connectivity, not the parsing logic.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphInstagramInsightsProvider } from "./graph-instagram-insights";

function jsonResponse(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

const MEDIA_LIST = {
  data: [
    {
      id: "media-1",
      media_type: "VIDEO",
      media_product_type: "REELS",
      timestamp: new Date().toISOString(),
      like_count: 1000,
      comments_count: 50,
      insights: { data: [{ name: "reach", values: [{ value: 5000 }] }, { name: "total_interactions", values: [{ value: 1200 }] }] },
    },
    {
      id: "media-2",
      media_type: "IMAGE",
      media_product_type: "FEED",
      timestamp: new Date().toISOString(),
      like_count: 300,
      comments_count: 20,
      insights: { data: [{ name: "reach", values: [{ value: 2000 }] }, { name: "total_interactions", values: [{ value: 400 }] }] },
    },
  ],
};

const CITY_DEMOGRAPHICS = {
  data: [
    {
      name: "follower_demographics",
      total_value: {
        breakdowns: [{ results: [{ dimension_values: ["Kochi"], value: 300 }, { dimension_values: ["Chennai"], value: 100 }] }],
      },
    },
  ],
};

const AGE_GENDER_DEMOGRAPHICS = {
  data: [
    {
      name: "follower_demographics",
      total_value: {
        breakdowns: [
          {
            results: [
              { dimension_values: ["25-34", "M"], value: 400 },
              { dimension_values: ["25-34", "F"], value: 200 },
              { dimension_values: ["18-24", "F"], value: 100 },
            ],
          },
        ],
      },
    },
  ],
};

function mockFetchImpl(urlStr: string) {
  const url = new URL(urlStr);
  if (url.pathname.endsWith("/media")) return jsonResponse(MEDIA_LIST);
  if (url.pathname.endsWith("/insights")) {
    const metric = url.searchParams.get("metric");
    const metricType = url.searchParams.get("metric_type");
    if (metric === "follows_and_unfollows") {
      return jsonResponse({
        data: [
          {
            name: "follows_and_unfollows",
            total_value: { breakdowns: [{ results: [{ dimension_values: ["FOLLOWER"], value: 500 }, { dimension_values: ["NON_FOLLOWER"], value: 120 }] }] },
          },
        ],
      });
    }
    if (metric === "follower_demographics") {
      return url.searchParams.get("breakdown") === "city" ? jsonResponse(CITY_DEMOGRAPHICS) : jsonResponse(AGE_GENDER_DEMOGRAPHICS);
    }
    if (metric === "reach" && metricType === "time_series") {
      return jsonResponse({ data: [{ name: "reach", total_value: { timeseries: Array.from({ length: 56 }, () => ({ value: 100_000 })) } }] });
    }
    // reach/accounts_engaged/profile_links_taps total_value — single number is enough here.
    return jsonResponse({ data: [{ name: metric, total_value: { value: 10_000 } }] });
  }
  // /{ig-user-id}?fields=followers_count
  return jsonResponse({ followers_count: 1_000_000 });
}

describe("GraphInstagramInsightsProvider", () => {
  beforeEach(() => {
    process.env.INSTAGRAM_ACCESS_TOKEN = "test-token";
    process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID = "test-account-id";
    vi.stubGlobal("fetch", vi.fn((url: string) => mockFetchImpl(url)));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.INSTAGRAM_ACCESS_TOKEN;
    delete process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  });

  it("parses account insights from total_value/breakdown/time_series shapes", async () => {
    const provider = new GraphInstagramInsightsProvider();
    const insights = await provider.getAccountInsights();

    expect(insights.followers).toBe(1_000_000);
    expect(insights.reach30d).toBe(10_000);
    // follows_and_unfollows: FOLLOWER(500) - NON_FOLLOWER(120)
    expect(insights.followersDeltaWeek).toBe(380);
    // reach time_series: 56 days of 100_000 -> 8 weekly buckets of 700_000 -> 0.7M
    expect(insights.reachByWeek).toHaveLength(8);
    expect(insights.reachByWeek[0]).toBeCloseTo(0.7, 5);
    // media-derived fields computed from the 2-post sample
    expect(insights.postsThisMonth).toBe(2);
    expect(insights.bestFormat).toBe("reel"); // higher total_interactions (1200 vs 400)
    expect(insights.avgReelViews).toBe(5000);
    expect(insights.engagementBreakdown.likes).toBe(1300);
    expect(insights.engagementBreakdown.comments).toBe(70);
    // fields with no real Graph API source are left explicit placeholders, not fabricated
    expect(insights.followerGrowth12w).toEqual([]);
  });

  it("parses demographics breakdown rows into city/age/gender aggregates", async () => {
    const provider = new GraphInstagramInsightsProvider();
    const demographics = await provider.getAudienceDemographics();

    expect(demographics.topCity).toBe("Kochi");
    expect(demographics.topCityPct).toBe(75); // 300 / (300+100)
    expect(demographics.dominantAge).toBe("25-34"); // 400+200 = 600 vs 100
    expect(demographics.genderSplit.male).toBe(57); // 400 / (400+300), rounded
    expect(demographics.genderSplit.female).toBe(43);
    // no Graph API metric exists for this at all — left empty, not fabricated
    expect(demographics.heatmap).toEqual({});
  });

  it("maps media list into Media[] for getSelfMedia", async () => {
    const provider = new GraphInstagramInsightsProvider();
    const media = await provider.getSelfMedia();

    expect(media).toHaveLength(2);
    expect(media[0]).toMatchObject({ id: "media-1", type: "reel", likes: 1000, comments: 50, reachOrViews: 5000 });
    expect(media[1]).toMatchObject({ id: "media-2", type: "photo", likes: 300, comments: 20, reachOrViews: 2000 });
  });
});
