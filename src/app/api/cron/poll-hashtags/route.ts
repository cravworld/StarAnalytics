// 15-minute polling cron (see vercel.json) — re-scrapes every currently-tracked
// hashtag and appends a fresh hashtag_snapshots row. Per the build plan: polling,
// not WebSocket/real-time push, for hashtag volume. The live post *stream* on a
// campaign detail page is separate — that's Supabase Realtime on `posts` inserts.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { trackHashtag } from "@/lib/data/campaigns";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Fail closed: an unset secret must never mean "no auth required" — this
    // endpoint triggers metered Apify scrapes and its path is predictable.
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const tracked = await prisma.hashtagSnapshot.groupBy({ by: ["hashtag"] });
  const results: { hashtag: string; ok: boolean; error?: string }[] = [];

  for (const { hashtag } of tracked) {
    try {
      await trackHashtag(hashtag);
      results.push({ hashtag, ok: true });
    } catch (err) {
      // One hashtag failing (rate limit, actor error) shouldn't block the rest of
      // the poll cycle — log and move on rather than aborting the whole run.
      results.push({ hashtag, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({ polled: results.length, results });
}
