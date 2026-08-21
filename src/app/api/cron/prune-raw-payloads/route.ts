// DPDP data-minimization cron: `posts.raw`, `post_comments.raw` and
// `scout_snapshots.raw` store the full Apify scrape payload, which the app
// never actually reads back (see
// DATA-PRIVACY.md) — every feature uses the structured columns (caption,
// author, engagement counts) that were already extracted from it at ingest
// time. Keeping the raw blob forever is over-collection with no product
// reason behind it, so this nulls it out once a post is old enough that
// nobody is going to need to re-derive something from it.
//
// RAW_PAYLOAD_RETENTION_DAYS is a policy decision, not an engineering one —
// defaulted to 90 here since nothing in the codebase implied a real number.
// Change the env var if that default is wrong for how this data actually
// gets used.
//
// Second job in the same handler, same reasoning: DATA-PRIVACY.md flagged
// "structured data (captions, comments, sentiment, engagement counts) still
// accumulates indefinitely" as an open product decision. Resolved as follows,
// not as a blanket policy — the structured-data bucket splits into two very
// different things:
//   - Post.caption/engagement counts (reach/likes/comments/saves/shares) are
//     the tracked accounts' OWN public content and the entire analytics
//     product (trend charts, "Top Posts This Month") is built on it staying
//     available indefinitely. Not pruned — there is no retention argument for
//     deleting a business's own historical performance data.
//   - Sentiment rows are an already-minimized derived signal (a label, a
//     score, a few keywords) with no raw text in them. Also not pruned, for
//     the same reason a rolled-up statistic isn't a data-minimization target.
//   - PostComment.text/authorHandle is the one bucket that's actually a
//     third party's personal data (a commenter's handle and words, not the
//     tracked account's own), and — confirmed by grep, same check used for
//     `raw` above — is read exactly once, by the sentiment classifier, and
//     never again afterward (see src/lib/data/sentiment.ts). That makes it
//     the structured-data analog of the raw-payload case, so it gets the
//     same treatment: nulled out after COMMENT_RETENTION_DAYS. The comment
//     row itself is kept (not hard-deleted) so comment counts stay accurate.
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_COMMENT_RETENTION_DAYS = 90;

function cutoffFrom(envVar: string, defaultDays: number): Date {
  const days = Number(process.env[envVar]) || defaultDays;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Fail closed: an unset secret must never mean "no auth required" — this
    // endpoint writes to every post/comment row past the cutoff.
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rawCutoff = cutoffFrom("RAW_PAYLOAD_RETENTION_DAYS", DEFAULT_RETENTION_DAYS);

  const posts = await prisma.post.updateMany({
    where: { scrapedAt: { lt: rawCutoff }, raw: { not: Prisma.DbNull } },
    data: { raw: Prisma.DbNull },
  });

  const comments = await prisma.postComment.updateMany({
    where: { scrapedAt: { lt: rawCutoff }, raw: { not: Prisma.DbNull } },
    data: { raw: Prisma.DbNull },
  });

  // Third raw-payload column, same cutoff and same reasoning as the two above. Scoutline
  // landed (2026-08-17) after this job was written (2026-07-30) and nobody came back to
  // it, so these accumulated indefinitely while the equivalent post/comment payloads
  // pruned at 90 days — an inconsistency by accident of ordering, not a judgement call.
  // If anything the argument is stronger here: scout_snapshots.raw is the full profile
  // payload for a third-party influencer who was put on someone's shortlist, with no
  // relationship to this business at all.
  //
  // Deliberately NOT extended to the derived Scoutline data (scout_candidates, the
  // snapshot metric columns, scout_scores). Whether a talent shortlist should age out is
  // a real product question — its value is partly historical, the same argument that
  // keeps posts' own engagement data forever — and it stays open. This is only the raw
  // blob, where the answer was already settled everywhere else in the schema.
  const scoutSnapshots = await prisma.scoutSnapshot.updateMany({
    where: { scrapedAt: { lt: rawCutoff }, raw: { not: Prisma.DbNull } },
    data: { raw: Prisma.DbNull },
  });

  // Campaign Post Tracking's two raw columns, same cutoff and same reasoning. Wired up in
  // the same PR that created the tables rather than left for someone to notice later —
  // which is exactly how scout_snapshots.raw went unpruned for three months (see above).
  //
  // Both hold a third party's payload: tracked_post_snapshots.raw is the full actor item
  // for an influencer's post, and one row is written per post PER SCAN, so this is the
  // fastest-growing raw column in the schema — a tracked post re-scanned daily produces a
  // new payload every day. tracked_account_snapshots.raw is the profile payload behind a
  // follower count.
  //
  // As everywhere else, only the raw blob is pruned. The structured metrics stay: they are
  // the campaign's own performance record, and the trend they form is the whole point of
  // the table being append-only.
  const trackedPostSnapshots = await prisma.trackedPostSnapshot.updateMany({
    where: { capturedAt: { lt: rawCutoff }, raw: { not: Prisma.DbNull } },
    data: { raw: Prisma.DbNull },
  });

  const trackedAccountSnapshots = await prisma.trackedAccountSnapshot.updateMany({
    where: { capturedAt: { lt: rawCutoff }, raw: { not: Prisma.DbNull } },
    data: { raw: Prisma.DbNull },
  });

  const commentTextCutoff = cutoffFrom("COMMENT_RETENTION_DAYS", DEFAULT_COMMENT_RETENTION_DAYS);

  const commentText = await prisma.postComment.updateMany({
    where: { scrapedAt: { lt: commentTextCutoff }, text: { not: null } },
    data: { text: null, authorHandle: null },
  });

  return NextResponse.json({
    rawCutoff: rawCutoff.toISOString(),
    postsPruned: posts.count,
    commentsRawPruned: comments.count,
    scoutSnapshotsRawPruned: scoutSnapshots.count,
    trackedPostSnapshotsRawPruned: trackedPostSnapshots.count,
    trackedAccountSnapshotsRawPruned: trackedAccountSnapshots.count,
    commentTextCutoff: commentTextCutoff.toISOString(),
    commentTextPruned: commentText.count,
  });
}
