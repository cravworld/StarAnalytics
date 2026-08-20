// Comment-scrape + sentiment classification pipeline — the two are one pipeline stage (see
// AGENTS.md Phase 4 §A4), triggered only for posts about to be classified, never as an
// independent always-on job. Order matters here: staleness filter first is what makes
// re-running this make zero new Apify/Claude calls on already-classified posts.
import { prisma } from "@/lib/prisma";
import { getSentimentProvider } from "@/lib/providers";
import { scrapeCommentsForPosts } from "@/lib/providers/apify-public-content";
import { runWithConcurrency } from "@/lib/concurrency";
import { tryAcquireCronLock, releaseCronLock } from "@/lib/cronLock";

const STALENESS_HOURS = 24;
const BATCH_SIZE = 20;
// Only bounds how many comments get blended into this post-level aggregate's classify text
// (see buildClassifyText below) — unrelated to apify-public-content.ts's own
// COMMENTS_PER_POST_LIMIT (how many comments get scraped) or commentSentiment.ts (which
// classifies every individual scraped comment regardless of this number). Left as 20 on
// purpose: stuffing thousands of comments into one blended prompt for a single aggregate
// row isn't what "classify all comments" asked for — that's what the per-comment pipeline
// in commentSentiment.ts is for.
const COMMENTS_PER_POST_LIMIT = 20;
// Same reasoning as commentSentiment.ts's BATCH_CONCURRENCY — see that file.
const BATCH_CONCURRENCY = Number(process.env.SENTIMENT_BATCH_CONCURRENCY) || 5;

// poll-hashtags (via its after()-deferred queueSentimentClassification) and backfill-sentiment
// are both scheduled 0 * * * * in vercel.json — same hour, same minute. Confirmed in prod
// (2026-08-04 DB audit): both processes independently read "this post has 0 comments" before
// either had written any, and both paid Apify to scrape the same post's comments — 61 exact
// duplicate (post, comment) rows and one post with 225 stored comments (over the 200/run cap)
// were the receipts. This lock serializes the scrape-then-store step across whichever process
// gets there first; the loser just skips its own comment scrape for this pass (posts fall back
// to caption-only, same as any other transient comment-scrape failure) rather than racing.
const COMMENT_SCRAPE_LOCK = "comment-scrape-pipeline";
// Sized off the real ceiling of one scrapeCommentsForPosts call: at most
// APIFY_COMMENT_POSTS_PER_INVOCATION / APIFY_COMMENT_POSTS_PER_RUN runs (3 by default), each
// waiting at most DEFAULT_WAIT_MS (5 min), plus a buffer. Was 21 minutes against waitForRun's
// old 20-minute ceiling — but no caller could ever wait that long (Vercel killed them first),
// so a killed invocation held this lock long after its work had stopped, blocking the next
// tick's comment scrape for nothing.
const COMMENT_SCRAPE_LOCK_TTL_SECONDS = 16 * 60 + 60;

/**
 * Master switch for the comment SCRAPE — the only part of this pipeline that spends Apify.
 *
 * Off by default, deliberately. Comment Sentiment is not in use right now, and the scrape is
 * metered per comment ($0.0023 at our tier), so the pipeline should cost nothing while it sits
 * idle. Defaulting to off rather than reading an "off" value means a deploy alone stops the
 * spend — no Vercel dashboard change to remember, and no way to leave it running by forgetting
 * to set something.
 *
 * Nothing is deleted: set COMMENT_SCRAPE=on to bring it straight back. Everything downstream
 * (classification, the /campaigns/comments screen, repeat-critic detection) still works on
 * comments already stored — this only stops fetching NEW ones.
 *
 * Callers that need comments regardless pass `{ scrapeComments: true }` explicitly. The agency
 * report does: its scrape is user-initiated, bounded to one uploaded batch, and its
 * generic_comment_pattern flag is only honest if the comments were actually fetched.
 */
export function isCommentScrapeEnabled(): boolean {
  return process.env.COMMENT_SCRAPE === "on";
}

/**
 * Master switch for CLASSIFICATION — the AI half of this pipeline, downstream of the scrape.
 *
 * Off by default, for the same "a deploy alone stops it" reason as the scrape switch above.
 * As of 2026-08-20 all three sentiment providers are out of credit — Claude 400 "credit
 * balance is too low", OpenAI 429 "no credits remaining", Gemini 429 "prepayment credits are
 * depleted" — so every classification attempt walks the whole Claude -> OpenAI -> Gemini
 * fallback chain, fails three times, and logs three errors. The fallback chain is working
 * exactly as designed; there is simply nothing left to fall back to.
 *
 * Deliberately NOT done by pointing DATA_MODE_SENTIMENT at "mock". MockSentimentProvider
 * labels every post "pos" at 0.78 with canned keywords, and those rows are written to the
 * same Sentiment table the real ones go to, indistinguishable afterwards. Off has to mean
 * "no rows", not "invented rows" — a screen reading 100% positive because a mock said so is
 * worse than the failure it replaces, and un-picking it later means guessing which rows were
 * real.
 *
 * Comments are unaffected: the scrape above still runs for callers that opt in, so text keeps
 * accumulating and is there to classify the moment this is switched back on. Nothing is
 * deleted, and already-classified posts keep their labels. Set SENTIMENT_CLASSIFY=on once any
 * one of the three providers has balance.
 */
export function isSentimentClassifyEnabled(): boolean {
  return process.env.SENTIMENT_CLASSIFY === "on";
}

/** Whether a given call should fetch new comments — explicit opt-in beats the global default. */
export interface SentimentOptions {
  scrapeComments?: boolean;
}

function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

// Caption + up to COMMENTS_PER_POST_LIMIT comments, oldest-scraped-first is fine — order
// doesn't carry meaning for the classifier, it just needs the text. Caption-only posts (zero
// comments captured, e.g. a fresh scrape that hasn't reached the comment step) still classify.
function buildClassifyText(
  post: { caption: string | null },
  comments: { text: string | null }[],
): string {
  const parts = [post.caption ?? ""];
  // text is null once the prune-raw-payloads cron has cleared old comment rows past
  // COMMENT_RETENTION_DAYS — falls back to caption-only, same as a fresh zero-comment post.
  for (const c of comments.slice(0, COMMENTS_PER_POST_LIMIT)) if (c.text) parts.push(c.text);
  return parts.filter(Boolean).join("\n");
}

// For fire-and-forget call sites (after() callbacks) — a sentiment failure must never take
// down the ingestion path it's attached to (hashtag tracking, the cron poll, the agency batch
// job). Callers that need to know about failures (e.g. the backfill route) should call
// classifyPostsForSentiment directly instead.
export async function queueSentimentClassification(
  postIds: string[],
  opts: SentimentOptions = {},
): Promise<void> {
  try {
    await classifyPostsForSentiment(postIds, opts);
  } catch (err) {
    console.error("sentiment pipeline failed:", err);
  }
}

export async function classifyPostsForSentiment(
  postIds: string[],
  opts: SentimentOptions = {},
): Promise<void> {
  if (postIds.length === 0) return;

  // 1. Staleness filter FIRST — drop posts with a sentiment row newer than the threshold
  // before touching Apify or Claude at all. This is the sole reason re-running this function
  // over the same ids makes zero new API calls of either kind.
  const staleCutoff = new Date(Date.now() - STALENESS_HOURS * 60 * 60 * 1000);
  const fresh = await prisma.sentiment.findMany({
    where: { postId: { in: postIds }, analyzedAt: { gte: staleCutoff } },
    select: { postId: true },
  });
  const freshIds = new Set(fresh.map((s) => s.postId));
  const workingIds = postIds.filter((id) => !freshIds.has(id));
  if (workingIds.length === 0) {
    console.log("sentiment pipeline: 0 posts to classify (all fresh)");
    return;
  }

  const posts = await prisma.post.findMany({
    where: { id: { in: workingIds } },
    include: { postComments: { select: { text: true } } },
  });

  // 2. Comment scrape only for survivors lacking captured comments. Isolated in its own
  // try/catch: a single post with a very large comment thread can make the whole batched
  // Apify run time out — without this, that one
  // slow post used to abort classification for the *entire* batch, including posts that
  // already had comments or needed no scraping at all. Since the same CHUNK_SIZE selection
  // is deterministic, that repeatedly re-picked the same poisoned batch and classification
  // progress stalled completely rather than just slowing down. Affected posts fall back to
  // caption-only text this pass (buildClassifyText already handles zero comments) and get a
  // real comment-based re-classification whenever a later attempt succeeds.
  //
  // p.comments !== 0 excludes posts the original hashtag/post scrape already reported as
  // having zero comments (commentsCount from the same Apify item, see apify-normalize.ts) —
  // confirmed in prod (2026-08-04 audit) that 322 posts sit at 0 stored comments forever
  // because they genuinely have none, yet kept re-entering this filter and paying for a fresh
  // Apify comment-scrape every time their Sentiment row went stale (~daily). null (comments
  // count unknown, e.g. agency-ingested posts) still passes through and gets a real attempt.
  //
  // commentsScrapedAt === null is the other half of that same leak, and the larger one: a
  // post whose reported count is nonzero but which yields nothing (private, deleted, comments
  // since disabled, or an attribution miss in the actor's URL echo) also stores zero rows,
  // so "no stored comments" alone re-qualified it every single cycle, forever, at full price.
  // The column records that we already spent money finding out. One attempt per post, ever —
  // which matches the previous *intent* ("comments aren't re-scraped once captured"), it just
  // now also holds for the posts where capturing produced nothing.
  const needComments = posts.filter(
    (p) => p.postComments.length === 0 && p.externalUrl && p.comments !== 0 && p.commentsScrapedAt === null,
  );
  // Explicit opt-in wins; otherwise the global switch decides. See isCommentScrapeEnabled.
  const scrapeComments = opts.scrapeComments ?? isCommentScrapeEnabled();
  if (needComments.length > 0 && !scrapeComments) {
    // Logged rather than silent: "0 comments stored" and "comment scraping is switched off"
    // look identical downstream, and the difference matters — the first is a finding, the
    // second is a config choice. Posts fall back to caption-only, exactly as they already do
    // when a scrape fails, so classification still runs.
    console.log(
      `sentiment pipeline: comment scrape is OFF (COMMENT_SCRAPE!=="on"), skipping ${needComments.length} post(s) that would have been scraped; classifying caption-only`,
    );
  }

  if (needComments.length > 0 && scrapeComments) {
    // See COMMENT_SCRAPE_LOCK above — this is what stops poll-hashtags and backfill-sentiment
    // from both paying Apify to scrape the same post at once. Losing the lock isn't an error:
    // this pass just falls back to caption-only for these posts, same as a scrape failure.
    if (await tryAcquireCronLock(COMMENT_SCRAPE_LOCK, COMMENT_SCRAPE_LOCK_TTL_SECONDS)) {
      try {
        await scrapeCommentsForPosts(needComments.map((p) => ({ id: p.id, externalUrl: p.externalUrl! })));
      } catch (err) {
        console.error(
          `sentiment pipeline: comment scrape failed for ${needComments.length} post(s), continuing caption-only for this batch:`,
          err,
        );
      } finally {
        await releaseCronLock(COMMENT_SCRAPE_LOCK);
      }
    } else {
      console.log(
        `sentiment pipeline: comment-scrape lock held by another invocation, skipping comment scrape for ${needComments.length} post(s) this pass (caption-only)`,
      );
    }
  }
  // Classification gate. Deliberately placed AFTER the scrape and before anything that
  // costs an AI call, so "off" still means comments get pulled and stored — they just sit
  // unclassified until this is switched back on. See isSentimentClassifyEnabled.
  //
  // Returning here leaves no Sentiment row, which is the honest outcome: the screens render
  // their "not classified" empty states rather than a fabricated reading, and because the
  // staleness filter at the top keys off those rows, every skipped post is picked up
  // automatically on the first run after the switch flips — no backfill to remember.
  if (!isSentimentClassifyEnabled()) {
    console.log(
      `sentiment pipeline: classification is OFF (SENTIMENT_CLASSIFY!=="on"), leaving ${workingIds.length} post(s) unclassified; comments already scraped are kept`,
    );
    return;
  }

  // Re-fetch comments for the whole working set in one go — cheaper than tracking which
  // posts were freshly scraped vs already had comments, and always reflects reality.
  const allComments = await prisma.postComment.findMany({
    where: { postId: { in: workingIds } },
    select: { postId: true, text: true },
  });
  const commentsByPost = new Map<string, { text: string | null }[]>();
  for (const c of allComments) {
    const list = commentsByPost.get(c.postId) ?? [];
    list.push({ text: c.text });
    commentsByPost.set(c.postId, list);
  }

  // 3. Build {id, text} for every survivor.
  const inputs = posts.map((p) => ({ id: p.id, text: buildClassifyText(p, commentsByPost.get(p.id) ?? []) }));

  // 4-5. Batch + classify.
  const provider = getSentimentProvider();
  const batches = chunk(inputs, BATCH_SIZE);
  console.log(`sentiment pipeline: classifying ${inputs.length} posts across ${batches.length} batch(es)`);

  // One batch failing (a Claude call error, or a response that never parses even after
  // classifyBatch's recursive halving bottoms out) must not abandon every batch queued
  // after it — same "one failure shouldn't block the rest" discipline as poll-hashtags'
  // per-hashtag try/catch. Before this, a single bad batch mid-run silently truncated the
  // whole classification pass; anything after it just never got attempted until the next
  // trigger (next day's cron, at best), with no signal beyond a swallowed console.error.
  //
  // Batches run concurrently (see commentSentiment.ts for the same pattern at higher
  // volume) — on Vercel Pro's raised maxDuration, wall-clock per invocation is the real
  // constraint, and running batches one at a time leaves that budget unused.
  let failedBatches = 0;
  const batchResults = await runWithConcurrency(batches, BATCH_CONCURRENCY, async (batch, i) => {
    try {
      return await provider.classify(batch);
    } catch (err) {
      failedBatches++;
      console.error(
        `sentiment pipeline: batch ${i + 1}/${batches.length} (${batch.length} posts) failed, continuing with remaining batches:`,
        err,
      );
      return [];
    }
  });
  // Upsert sentiment rows — sequential, not bulk: unlike comments (always a fresh insert),
  // a post can already have a stale Sentiment row that needs updating, so this stays a
  // real upsert per row rather than createMany.
  for (const results of batchResults) {
    for (const r of results) {
      await prisma.sentiment.upsert({
        where: { postId: r.id },
        create: {
          postId: r.id,
          label: r.label,
          score: r.score,
          keywords: r.keywords,
          // Per-result, not a single shared modelId — see SentimentResult.model's comment
          // in claude-sentiment.ts for why (the Claude -> OpenAI -> Gemini fallback chain
          // means different posts in the same run can be classified by different providers).
          model: r.model,
        },
        update: {
          label: r.label,
          score: r.score,
          keywords: r.keywords,
          model: r.model,
          analyzedAt: new Date(),
        },
      });
    }
  }
  if (failedBatches > 0) {
    console.error(`sentiment pipeline: ${failedBatches}/${batches.length} batch(es) failed — unclassified posts remain stale and will retry next run`);
  }
}
