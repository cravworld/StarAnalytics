import { describe, it, expect } from "vitest";
import {
  formatWeeklyDigest,
  formatWeeklyDigestHtml,
  sortCampaignsByBuzz,
  type WeeklyDigestCampaignSummary,
} from "./weeklyDigest";

const GENERATED_AT = new Date("2026-08-10T09:00:00Z");
// Same hex values as SENTIMENT_COLOR in weeklyDigest.ts (module-private, not exported) —
// duplicated here rather than exported-just-for-tests, matching how buzzBandColor's colors
// are asserted directly by value elsewhere in this file.
const SENTIMENT_UP_COLOR = "#1a7a4a";
const SENTIMENT_DOWN_COLOR = "#c62828";

const CAMPAIGN: WeeklyDigestCampaignSummary = {
  name: "Pluto Movie",
  buzzScore: 81,
  buzzWeekAgoDelta: 6,
  postCount: 361,
  engagementDisplay: "146.7K",
  sentiment: { positivePct: 60, neutralPct: 32, negativePct: 8, classifiedCount: 361, totalCount: 361 },
  topHashtag: { hashtag: "pluto", postCount: 76, totalEngagement: 17496 },
};

describe("sortCampaignsByBuzz", () => {
  it("orders highest buzz score first", () => {
    const low: WeeklyDigestCampaignSummary = { ...CAMPAIGN, name: "Low", buzzScore: 20 };
    const high: WeeklyDigestCampaignSummary = { ...CAMPAIGN, name: "High", buzzScore: 90 };
    const mid: WeeklyDigestCampaignSummary = { ...CAMPAIGN, name: "Mid", buzzScore: 55 };
    const sorted = sortCampaignsByBuzz([low, high, mid]);
    expect(sorted.map((c) => c.name)).toEqual(["High", "Mid", "Low"]);
  });

  it("does not mutate the input array", () => {
    const input = [{ ...CAMPAIGN, buzzScore: 20 }, { ...CAMPAIGN, buzzScore: 90 }];
    const inputCopy = [...input];
    sortCampaignsByBuzz(input);
    expect(input).toEqual(inputCopy);
  });
});

describe("formatWeeklyDigest", () => {
  it("reports no live campaigns honestly rather than an empty section", () => {
    const text = formatWeeklyDigest([], GENERATED_AT);
    expect(text).toContain("No live campaigns this week.");
  });

  it("includes a live-campaign count and every campaign's stats", () => {
    const text = formatWeeklyDigest([CAMPAIGN], GENERATED_AT);
    expect(text).toContain("1 live campaign this week");
    expect(text).toContain("Pluto Movie");
    expect(text).toContain("Buzz score: 81");
    expect(text).toContain("361 (146.7K engagement)");
    expect(text).toContain("60% positive / 32% neutral / 8% negative (361/361 classified)");
    expect(text).toContain("#pluto (76 posts, 17,496 eng)");
  });

  it("pluralizes the campaign count correctly", () => {
    const second: WeeklyDigestCampaignSummary = { ...CAMPAIGN, name: "NP50" };
    const text = formatWeeklyDigest([CAMPAIGN, second], GENERATED_AT);
    expect(text).toContain("2 live campaigns this week");
  });

  // Sentiment/hashtag are the two fields that can legitimately be absent on a fresh
  // campaign — must render an honest "pending"/"none tracked" line, never fabricate a
  // number or silently omit the campaign, same discipline as SentimentBar's null state.
  it("renders pending sentiment and no-hashtag campaigns honestly, not as a fabricated zero", () => {
    const fresh: WeeklyDigestCampaignSummary = {
      name: "New Launch",
      buzzScore: 12,
      buzzWeekAgoDelta: null,
      postCount: 2,
      engagementDisplay: "40",
      sentiment: null,
      topHashtag: null,
    };
    const text = formatWeeklyDigest([fresh], GENERATED_AT);
    expect(text).toContain("Sentiment: pending — no posts classified yet");
    expect(text).toContain("Top hashtag: none tracked");
  });

  it("lists multiple campaigns in the order given (ordering is the caller's job, see sortCampaignsByBuzz)", () => {
    const second: WeeklyDigestCampaignSummary = { ...CAMPAIGN, name: "NP50", buzzScore: 84 };
    const text = formatWeeklyDigest([CAMPAIGN, second], GENERATED_AT);
    expect(text.indexOf("Pluto Movie")).toBeLessThan(text.indexOf("NP50"));
  });

  it("shows a signed week-over-week delta when one exists, and omits it entirely otherwise", () => {
    const up = formatWeeklyDigest([{ ...CAMPAIGN, buzzWeekAgoDelta: 6 }], GENERATED_AT);
    expect(up).toContain("Buzz score: 81 (+6 vs last week)");

    const down = formatWeeklyDigest([{ ...CAMPAIGN, buzzWeekAgoDelta: -4 }], GENERATED_AT);
    expect(down).toContain("Buzz score: 81 (-4 vs last week)");

    const none = formatWeeklyDigest([{ ...CAMPAIGN, buzzWeekAgoDelta: null }], GENERATED_AT);
    expect(none).toContain("Buzz score: 81");
    expect(none).not.toContain("vs last week");
  });
});

describe("formatWeeklyDigestHtml", () => {
  it("reports no live campaigns honestly rather than an empty card list", () => {
    const html = formatWeeklyDigestHtml([], GENERATED_AT);
    expect(html).toContain("No live campaigns this week.");
  });

  it("includes a live-campaign count and every campaign's name, buzz score, engagement, sentiment, and top hashtag", () => {
    const html = formatWeeklyDigestHtml([CAMPAIGN], GENERATED_AT);
    expect(html).toContain("1 live campaign this week");
    expect(html).toContain("Pluto Movie");
    expect(html).toContain(">81<");
    expect(html).toContain("146.7K");
    expect(html).toContain("60% positive");
    expect(html).toContain("#pluto");
  });

  it("colors the buzz badge by the same green/yellow/red bands as the dashboard", () => {
    const green = formatWeeklyDigestHtml([{ ...CAMPAIGN, buzzScore: 81 }], GENERATED_AT);
    const yellow = formatWeeklyDigestHtml([{ ...CAMPAIGN, buzzScore: 55 }], GENERATED_AT);
    const red = formatWeeklyDigestHtml([{ ...CAMPAIGN, buzzScore: 20 }], GENERATED_AT);
    expect(green).toContain("#1a7a4a");
    expect(yellow).toContain("#e6a700");
    expect(red).toContain("#c62828");
  });

  it("renders a 3-segment sentiment bar using the same colors as the in-app SentimentBar", () => {
    const html = formatWeeklyDigestHtml([CAMPAIGN], GENERATED_AT);
    expect(html).toContain('width="60%"');
    expect(html).toContain('width="32%"');
    expect(html).toContain('width="8%"');
    expect(html).toContain("#bdbdbd"); // neutral segment color
  });

  it("omits a zero-width sentiment segment rather than emitting a pointless width=\"0%\" cell", () => {
    const allPositive: WeeklyDigestCampaignSummary = {
      ...CAMPAIGN,
      sentiment: { positivePct: 100, neutralPct: 0, negativePct: 0, classifiedCount: 10, totalCount: 10 },
    };
    const html = formatWeeklyDigestHtml([allPositive], GENERATED_AT);
    expect(html).not.toContain('width="0%"');
  });

  it("marks only the single top-scoring campaign as Top Performer, and only when its score is genuinely green-band", () => {
    const strong: WeeklyDigestCampaignSummary = { ...CAMPAIGN, name: "Strong", buzzScore: 85 };
    const weak: WeeklyDigestCampaignSummary = { ...CAMPAIGN, name: "Weak", buzzScore: 30 };
    const withStrong = formatWeeklyDigestHtml([strong, weak], GENERATED_AT);
    expect(withStrong).toContain("TOP PERFORMER");
    expect((withStrong.match(/TOP PERFORMER/g) ?? []).length).toBe(1);

    // Even sorted first, a sub-70 score never earns the tag — "happened to be highest of a
    // bad week" isn't the same claim as "this is actually good."
    const onlyWeak = formatWeeklyDigestHtml([weak], GENERATED_AT);
    expect(onlyWeak).not.toContain("TOP PERFORMER");
  });

  it("renders pending sentiment and no-hashtag campaigns honestly, not as a fabricated zero", () => {
    const fresh: WeeklyDigestCampaignSummary = {
      name: "New Launch",
      buzzScore: 12,
      buzzWeekAgoDelta: null,
      postCount: 2,
      engagementDisplay: "40",
      sentiment: null,
      topHashtag: null,
    };
    const html = formatWeeklyDigestHtml([fresh], GENERATED_AT);
    expect(html).toContain("pending");
    expect(html).toContain("none tracked");
  });

  // A campaign name is the account owner's own free-text input (createCampaign has no
  // sanitization on it) — must not be interpolated raw into HTML, or a name containing
  // "<"/"&" would corrupt the email's markup for every recipient, not just show oddly.
  it("HTML-escapes campaign names so a stray < or & can't break the email markup", () => {
    const html = formatWeeklyDigestHtml([{ ...CAMPAIGN, name: "R&D <Launch>" }], GENERATED_AT);
    expect(html).toContain("R&amp;D &lt;Launch&gt;");
    expect(html).not.toContain("<Launch>");
  });

  it("shows a signed, colored week-over-week delta when one exists, and omits it entirely otherwise", () => {
    const up = formatWeeklyDigestHtml([{ ...CAMPAIGN, buzzWeekAgoDelta: 6 }], GENERATED_AT);
    expect(up).toContain("+6 vs last week");
    expect(up).toContain(SENTIMENT_UP_COLOR);

    const down = formatWeeklyDigestHtml([{ ...CAMPAIGN, buzzWeekAgoDelta: -4 }], GENERATED_AT);
    expect(down).toContain("-4 vs last week");
    expect(down).toContain(SENTIMENT_DOWN_COLOR);

    const none = formatWeeklyDigestHtml([{ ...CAMPAIGN, buzzWeekAgoDelta: null }], GENERATED_AT);
    expect(none).not.toContain("vs last week");
  });
});
