import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Classification is switched off while every sentiment provider is out of credit, and this
 * pins what "off" is allowed to mean.
 *
 * Two properties, and the second is the one worth having. The first is the flag's own
 * semantics — off unless the exact opt-in value, same discipline as COMMENT_SCRAPE next to
 * it. The second is behavioural: off must skip the AI call AND write no Sentiment row, while
 * still letting the comment scrape run for callers that opted into it. That combination is
 * the entire point. A gate placed one step earlier would stop comments being collected; a
 * gate that fell through to the mock provider would fill the table with fabricated "pos"
 * rows indistinguishable from real ones. Neither would fail a test that only checked the
 * boolean.
 */

const classify = vi.fn(async (batch: { id: string }[]) =>
  batch.map((b) => ({ id: b.id, label: "pos", score: 0.9, keywords: [], model: "test" })),
);
const scrapeCommentsForPosts = vi.fn(async () => {});
const sentimentUpsert = vi.fn(async () => ({}));

const prisma = {
  sentiment: { findMany: vi.fn(async () => []), upsert: sentimentUpsert },
  post: {
    findMany: vi.fn(async () => [
      {
        id: "post-1",
        caption: "what a film",
        externalUrl: "https://example.test/p/1",
        comments: 5,
        commentsScrapedAt: null,
        postComments: [],
      },
    ]),
  },
  postComment: { findMany: vi.fn(async () => []) },
};

vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/providers", () => ({ getSentimentProvider: () => ({ classify }) }));
vi.mock("@/lib/providers/apify-public-content", () => ({ scrapeCommentsForPosts }));
vi.mock("@/lib/cronLock", () => ({
  tryAcquireCronLock: vi.fn(async () => true),
  releaseCronLock: vi.fn(async () => {}),
}));

const originalFlag = process.env.SENTIMENT_CLASSIFY;

describe("isSentimentClassifyEnabled", () => {
  afterEach(() => {
    if (originalFlag === undefined) delete process.env.SENTIMENT_CLASSIFY;
    else process.env.SENTIMENT_CLASSIFY = originalFlag;
  });

  it("is off when unset — a fresh environment must not start spending on AI calls", async () => {
    delete process.env.SENTIMENT_CLASSIFY;
    const { isSentimentClassifyEnabled } = await import("./sentiment");
    expect(isSentimentClassifyEnabled()).toBe(false);
  });

  it("is on only for the exact opt-in value", async () => {
    const { isSentimentClassifyEnabled } = await import("./sentiment");
    process.env.SENTIMENT_CLASSIFY = "on";
    expect(isSentimentClassifyEnabled()).toBe(true);
    for (const v of ["off", "false", "0", "", "true", "1", "yes", "ON"]) {
      process.env.SENTIMENT_CLASSIFY = v;
      expect(isSentimentClassifyEnabled(), `SENTIMENT_CLASSIFY=${JSON.stringify(v)}`).toBe(false);
    }
  });
});

describe("the pipeline with classification off", () => {
  beforeEach(() => {
    classify.mockClear();
    scrapeCommentsForPosts.mockClear();
    sentimentUpsert.mockClear();
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.SENTIMENT_CLASSIFY;
    else process.env.SENTIMENT_CLASSIFY = originalFlag;
  });

  it("still scrapes comments, but classifies nothing and stores no sentiment", async () => {
    delete process.env.SENTIMENT_CLASSIFY;
    const { classifyPostsForSentiment } = await import("./sentiment");

    await classifyPostsForSentiment(["post-1"], { scrapeComments: true });

    expect(scrapeCommentsForPosts, "comments must still be collected while classification is off").toHaveBeenCalledTimes(1);
    expect(classify, "no AI call may be made while classification is off").not.toHaveBeenCalled();
    expect(sentimentUpsert, "an unclassified post must leave no Sentiment row at all").not.toHaveBeenCalled();
  });

  it("classifies again as soon as the switch is on", async () => {
    process.env.SENTIMENT_CLASSIFY = "on";
    const { classifyPostsForSentiment } = await import("./sentiment");

    await classifyPostsForSentiment(["post-1"], { scrapeComments: true });

    expect(classify).toHaveBeenCalledTimes(1);
    expect(sentimentUpsert).toHaveBeenCalledTimes(1);
  });
});
