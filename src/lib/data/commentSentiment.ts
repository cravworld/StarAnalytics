// Per-comment sentiment classification — separate pipeline from classifyPostsForSentiment
// in sentiment.ts, which blends a post's caption + a comment sample into one post-level
// Sentiment row for the existing campaign dashboards. This one writes a CommentSentiment
// row per individual PostComment, which is what hater/repeat-offender detection needs: a
// real per-commenter signal, not an aggregate. See prisma/schema.prisma's CommentSentiment
// model comment for why it's a separate table.
//
// No staleness window here (unlike classifyPostsForSentiment): comment text never changes
// once scraped, so "already classified" is a permanent, not time-boxed, state — a comment
// either has a CommentSentiment row or it doesn't.
import { prisma } from "@/lib/prisma";
import { getSentimentModelId, getSentimentProvider } from "@/lib/providers";
import { runWithConcurrency } from "@/lib/concurrency";

// Larger than classifyPostsForSentiment's BATCH_SIZE (20): each input here is one short
// comment rather than a caption blended with up to 20 comments, so more fit per Claude call.
const BATCH_SIZE = 50;

// Claude calls in flight at once. Vercel Pro's raised maxDuration means wall-clock per
// invocation, not cost, is the real constraint on how much of a backlog one call can grind
// through — running batches concurrently instead of one-at-a-time is what actually uses
// that extra time rather than just raising a ceiling nothing fills. Bounded (not unlimited)
// to avoid thrashing Anthropic's own rate limits, which a larger Vercel plan doesn't touch.
// Env-configurable so it's a tuning knob, not a redeploy, if real throughput needs it higher
// or lower.
const BATCH_CONCURRENCY = Number(process.env.SENTIMENT_BATCH_CONCURRENCY) || 5;

function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

export async function classifyCommentsForSentiment(
  commentIds: string[],
): Promise<{ classified: number; failedBatches: number }> {
  if (commentIds.length === 0) return { classified: 0, failedBatches: 0 };

  // Only comments with text still present (not yet pruned by prune-raw-payloads) and not
  // already classified — same "skip what's already done" discipline as the post pipeline's
  // staleness filter, just permanent instead of time-boxed.
  const comments = await prisma.postComment.findMany({
    where: { id: { in: commentIds }, text: { not: null }, sentiment: null },
    select: { id: true, text: true, authorHandle: true },
  });
  if (comments.length === 0) return { classified: 0, failedBatches: 0 };

  const handleById = new Map(comments.map((c) => [c.id, c.authorHandle]));
  const inputs = comments.map((c) => ({ id: c.id, text: c.text! }));

  const provider = getSentimentProvider();
  const modelId = getSentimentModelId();
  const batches = chunk(inputs, BATCH_SIZE);
  console.log(
    `comment sentiment pipeline: classifying ${inputs.length} comments across ${batches.length} batch(es), concurrency ${BATCH_CONCURRENCY}`,
  );

  // One bad batch (a Claude call error, or a response that never parses) must not abandon
  // the rest — same discipline as classifyPostsForSentiment, just run concurrently instead
  // of sequentially. failedBatches++ here is safe under concurrency: JS is single-threaded,
  // and the increment itself has no `await` inside it, so no two runners can interleave on it.
  let failedBatches = 0;
  const batchResults = await runWithConcurrency(batches, BATCH_CONCURRENCY, async (batch, i) => {
    try {
      return await provider.classify(batch);
    } catch (err) {
      failedBatches++;
      console.error(
        `comment sentiment pipeline: batch ${i + 1}/${batches.length} (${batch.length} comments) failed, continuing with remaining batches:`,
        err,
      );
      return [];
    }
  });

  // Bulk insert instead of one upsert per result: every comment reaching this point was
  // already filtered to `sentiment: null` above, so this is always a fresh insert, never an
  // update — createMany is both correct here and far fewer DB round trips than N sequential
  // upserts. skipDuplicates guards against two overlapping cron invocations (a fast comment
  // backfill on a short cadence can outlive its own interval on a big chunk) racing on the
  // same comment; the loser's insert is silently skipped rather than erroring the batch.
  const allResults = batchResults.flat();
  if (allResults.length > 0) {
    await prisma.commentSentiment.createMany({
      data: allResults.map((r) => ({
        postCommentId: r.id,
        authorHandle: handleById.get(r.id) ?? null,
        label: r.label,
        score: r.score,
        model: modelId,
      })),
      skipDuplicates: true,
    });
  }

  if (failedBatches > 0) {
    console.error(
      `comment sentiment pipeline: ${failedBatches}/${batches.length} batch(es) failed — those comments remain unclassified and will retry next run`,
    );
  }
  return { classified: allResults.length, failedBatches };
}
