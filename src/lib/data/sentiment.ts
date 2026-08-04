// Comment-scrape + sentiment classification pipeline — the two are one pipeline stage (see
// AGENTS.md Phase 4 §A4), triggered only for posts about to be classified, never as an
// independent always-on job. Order matters here: staleness filter first is what makes
// re-running this make zero new Apify/Claude calls on already-classified posts.
import { prisma } from "@/lib/prisma";
import { getSentimentProvider } from "@/lib/providers";
import { scrapeCommentsForPosts } from "@/lib/providers/apify-public-content";
import { runWithConcurrency } from "@/lib/concurrency";

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
export async function queueSentimentClassification(postIds: string[]): Promise<void> {
  try {
    await classifyPostsForSentiment(postIds);
  } catch (err) {
    console.error("sentiment pipeline failed:", err);
  }
}

export async function classifyPostsForSentiment(postIds: string[]): Promise<void> {
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
  // try/catch: a single post with a very large comment thread (COMMENTS_PER_POST_LIMIT is
  // now uncapped) can make the whole batched Apify run time out — without this, that one
  // slow post used to abort classification for the *entire* batch, including posts that
  // already had comments or needed no scraping at all. Since the same CHUNK_SIZE selection
  // is deterministic, that repeatedly re-picked the same poisoned batch and classification
  // progress stalled completely rather than just slowing down. Affected posts fall back to
  // caption-only text this pass (buildClassifyText already handles zero comments) and get a
  // real comment-based re-classification whenever a later attempt succeeds.
  const needComments = posts.filter((p) => p.postComments.length === 0 && p.externalUrl);
  if (needComments.length > 0) {
    try {
      await scrapeCommentsForPosts(needComments.map((p) => ({ id: p.id, externalUrl: p.externalUrl! })));
    } catch (err) {
      console.error(
        `sentiment pipeline: comment scrape failed for ${needComments.length} post(s), continuing caption-only for this batch:`,
        err,
      );
    }
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
