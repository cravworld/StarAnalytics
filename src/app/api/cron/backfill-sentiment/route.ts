// One-time (re-runnable) backfill for existing campaign/agency posts lacking sentiment
// classification — see AGENTS.md Phase 4 §B3. Modeled on poll-hashtags (CRON_SECRET-auth,
// fail-closed), not on the NODE_ENV-gated /api/dev/* pattern: this must reach real posts in
// production, which a dev-only route never can. Safely re-runnable — classifyPostsForSentiment's
// own staleness filter means calling this repeatedly just processes whatever's left, with
// zero redundant Claude calls on posts already classified within the staleness window.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { classifyPostsForSentiment } from "@/lib/data/sentiment";

// Bounded per invocation so one call can't run indefinitely — re-invoke (e.g. via a loop of
// curl calls, or a few manual triggers) to work through a large backlog.
const CHUNK_SIZE = 100;
const STALENESS_HOURS = 24;

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const staleCutoff = new Date(Date.now() - STALENESS_HOURS * 60 * 60 * 1000);
  const candidates = await prisma.post.findMany({
    where: {
      source: { in: ["campaign", "agency"] },
      OR: [{ sentiment: null }, { sentiment: { analyzedAt: { lt: staleCutoff } } }],
    },
    select: { id: true },
    take: CHUNK_SIZE,
  });

  if (candidates.length === 0) {
    return NextResponse.json({ processed: 0, remaining: 0, message: "nothing to backfill" });
  }

  const postIds = candidates.map((p) => p.id);
  try {
    await classifyPostsForSentiment(postIds);
  } catch (err) {
    return NextResponse.json(
      { processed: 0, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  return NextResponse.json({ processed: postIds.length, chunkSize: CHUNK_SIZE });
}
