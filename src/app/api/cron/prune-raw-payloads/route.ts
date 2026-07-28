// DPDP data-minimization cron: `posts.raw` and `post_comments.raw` store the
// full Apify scrape payload, which the app never actually reads back (see
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
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

const DEFAULT_RETENTION_DAYS = 90;

function retentionCutoff(): Date {
  const days = Number(process.env.RAW_PAYLOAD_RETENTION_DAYS) || DEFAULT_RETENTION_DAYS;
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

  const cutoff = retentionCutoff();

  const posts = await prisma.post.updateMany({
    where: { scrapedAt: { lt: cutoff }, raw: { not: Prisma.DbNull } },
    data: { raw: Prisma.DbNull },
  });

  const comments = await prisma.postComment.updateMany({
    where: { scrapedAt: { lt: cutoff }, raw: { not: Prisma.DbNull } },
    data: { raw: Prisma.DbNull },
  });

  return NextResponse.json({
    cutoff: cutoff.toISOString(),
    postsPruned: posts.count,
    commentsPruned: comments.count,
  });
}
