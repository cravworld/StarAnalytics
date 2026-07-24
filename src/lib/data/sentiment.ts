// Comment-scrape + sentiment classification pipeline — the two are one pipeline stage (see
// AGENTS.md Phase 4 §A4), triggered only for posts about to be classified, never as an
// independent always-on job. Order matters here: staleness filter first is what makes
// re-running this make zero new Apify/Claude calls on already-classified posts.
import { prisma } from "@/lib/prisma";
import { getSentimentModelId, getSentimentProvider } from "@/lib/providers";
import { scrapeCommentsForPosts } from "@/lib/providers/apify-public-content";

const STALENESS_HOURS = 24;
const BATCH_SIZE = 20;
const COMMENTS_PER_POST_LIMIT = 20;

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
  comments: { text: string }[],
): string {
  const parts = [post.caption ?? ""];
  for (const c of comments.slice(0, COMMENTS_PER_POST_LIMIT)) parts.push(c.text);
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

  // 2. Comment scrape only for survivors lacking captured comments.
  const needComments = posts.filter((p) => p.postComments.length === 0 && p.externalUrl);
  if (needComments.length > 0) {
    await scrapeCommentsForPosts(needComments.map((p) => ({ id: p.id, externalUrl: p.externalUrl! })));
  }
  // Re-fetch comments for the whole working set in one go — cheaper than tracking which
  // posts were freshly scraped vs already had comments, and always reflects reality.
  const allComments = await prisma.postComment.findMany({
    where: { postId: { in: workingIds } },
    select: { postId: true, text: true },
  });
  const commentsByPost = new Map<string, { text: string }[]>();
  for (const c of allComments) {
    const list = commentsByPost.get(c.postId) ?? [];
    list.push({ text: c.text });
    commentsByPost.set(c.postId, list);
  }

  // 3. Build {id, text} for every survivor.
  const inputs = posts.map((p) => ({ id: p.id, text: buildClassifyText(p, commentsByPost.get(p.id) ?? []) }));

  // 4-5. Batch + classify.
  const provider = getSentimentProvider();
  const modelId = getSentimentModelId();
  const batches = chunk(inputs, BATCH_SIZE);
  console.log(`sentiment pipeline: classifying ${inputs.length} posts across ${batches.length} batch(es)`);

  // One batch failing (a Claude call error, or a response that never parses even after
  // classifyBatch's recursive halving bottoms out) must not abandon every batch queued
  // after it — same "one failure shouldn't block the rest" discipline as poll-hashtags'
  // per-hashtag try/catch. Before this, a single bad batch mid-run silently truncated the
  // whole classification pass; anything after it just never got attempted until the next
  // trigger (next day's cron, at best), with no signal beyond a swallowed console.error.
  let failedBatches = 0;
  for (const [i, batch] of batches.entries()) {
    let results;
    try {
      results = await provider.classify(batch);
    } catch (err) {
      failedBatches++;
      console.error(
        `sentiment pipeline: batch ${i + 1}/${batches.length} (${batch.length} posts) failed, continuing with remaining batches:`,
        err,
      );
      continue;
    }
    // 6. Upsert sentiment rows.
    for (const r of results) {
      await prisma.sentiment.upsert({
        where: { postId: r.id },
        create: {
          postId: r.id,
          label: r.label,
          score: r.score,
          keywords: r.keywords,
          model: modelId,
        },
        update: {
          label: r.label,
          score: r.score,
          keywords: r.keywords,
          model: modelId,
          analyzedAt: new Date(),
        },
      });
    }
  }
  if (failedBatches > 0) {
    console.error(`sentiment pipeline: ${failedBatches}/${batches.length} batch(es) failed — unclassified posts remain stale and will retry next run`);
  }
}
