// Read-only lookup for a DPDP access/correction/deletion request: given a social
// handle — or, with --name, a person's name — find every row across the schema
// that references them. Run with:
//   node --env-file=.env.local scripts/lookup-personal-data.mjs <handle>
//   node --env-file=.env.local scripts/lookup-personal-data.mjs --name "Some Person"
//
// This only reads — it does not delete anything. If a request needs fulfilling,
// review the output, decide what actually needs to go, and delete by id yourself
// (via `npm run db:studio` or a one-off script) rather than trusting this to do it.
//
// Every table searched is enumerated in the output's `searched` block, and that is
// load-bearing rather than decoration. This script's original failure mode (#29) was
// that it queried four models and printed an empty result for a handle whose data
// lived in tables it had never heard of — output indistinguishable from "we hold no
// data on this person", which is the wrong answer to give a regulator and points the
// wrong way. An empty result is only worth anything if the reader can see what was
// actually looked at. If you add a table that holds a handle or a name, add it here
// and to DATA-PRIVACY.md's coverage table — those two are meant to stay in step.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Searched in handle mode, in output order. The descriptions are aimed at whoever is
// actually fulfilling the request, who may not be the person who wrote the schema.
const HANDLE_TABLES = [
  ["posts", "author_handle", "Posts authored by this handle, with their sentiment score"],
  ["post_comments", "author_handle", "Comments left on tracked posts. Nulled after COMMENT_RETENTION_DAYS, so an old commenter matches nothing here — see comment_sentiment below"],
  ["comment_sentiment", "author_handle", "Denormalized copy of the commenter's handle taken at classification time, which SURVIVES the post_comments prune indefinitely (DATA-PRIVACY.md, Retention)"],
  ["competitor_accounts", "ig_handle", "Tracked as a competitor account"],
  ["fan_pages", "ig_handle", "Tracked as a fan page"],
  ["account_snapshots", "ig_handle", "Follower-count history. Outlives removeCompetitor(), which deletes the competitor row and deliberately leaves these behind"],
  ["scout_candidates", "ig_handle", "Scanned as part of a Scoutline talent shortlist"],
  ["scout_batch_entries", "via candidate_id", "Shortlist row: supplied name, row number, deliverable"],
  ["scout_snapshots", "via candidate_id", "Profile metrics plus the full raw scrape payload"],
  ["scout_scores", "via snapshot_id", "Derived Buzz Factor"],
  ["tracked_accounts", "handle", "Posted a campaign post that is being tracked. Stores handle and scraped display name"],
  ["tracked_account_snapshots", "via account_id", "Follower-count history captured each time their posts were re-scanned"],
  ["tracked_posts", "via account_id", "Their tracked campaign posts: URL, caption, media type, current engagement"],
  ["tracked_post_snapshots", "via tracked_post_id", "Per-scan engagement history plus the raw scrape payload, pruned at RAW_PAYLOAD_RETENTION_DAYS"],
  ["tracked_page_subscriptions", "via account_id", "Their whole page is subscribed for a campaign, so their NON-campaign posts are collected too — see DATA-PRIVACY.md. A deletion request must stop the subscription, or discovery will simply re-add the posts"],
];

// Searched in --name mode. Deliberately a different, much smaller set: a name is not a
// key anywhere in this schema, it is an incidental column on three tables. Anything
// keyed by handle is unreachable from a name alone, which is why the output says so.
const NAME_TABLES = [
  ["scout_batch_entries", "supplied_name", "Name typed into the uploaded shortlist source sheet — not scraped, so this is the one column a request is likely to arrive under"],
  ["competitor_accounts", "display_name", "Scraped profile display name"],
  ["fan_pages", "display_name", "Scraped profile display name"],
];

function describe(tables) {
  return tables.map(([table, column, note]) => ({ table, matchedOn: column, holds: note }));
}

function normalizeHandle(input) {
  return input.replace(/^@/, "").trim();
}

async function lookupByHandle(handle) {
  const insensitive = { equals: handle, mode: "insensitive" };

  // scout_candidates is matched on `handle`, NOT `profile_url_key` — the latter is
  // platform-prefixed ("instagram:somehandle") and will never equal a bare handle.
  // The same handle can legitimately exist on both platforms, so this is an array.
  const [
    ownPosts,
    comments,
    sentimentRows,
    competitor,
    fanPage,
    followerHistory,
    candidates,
    trackedAccounts,
  ] = await Promise.all([
      prisma.post.findMany({
        where: { authorHandle: insensitive },
        include: { sentiment: true },
      }),
      prisma.postComment.findMany({
        where: { authorHandle: insensitive },
        include: { post: { select: { id: true, authorHandle: true, externalUrl: true } } },
      }),
      prisma.commentSentiment.findMany({
        where: { authorHandle: insensitive },
        include: { postComment: { select: { id: true, postId: true, scrapedAt: true } } },
      }),
      prisma.competitorAccount.findMany({ where: { igHandle: insensitive } }),
      prisma.fanPage.findMany({ where: { igHandle: insensitive } }),
      prisma.accountSnapshot.findMany({
        where: { igHandle: insensitive },
        orderBy: { capturedAt: "desc" },
      }),
      prisma.scoutCandidate.findMany({
        where: { handle: insensitive },
        include: {
          batchEntries: {
            include: {
              batch: {
                select: { id: true, fileName: true, createdAt: true, archivedAt: true },
              },
            },
          },
          // `raw` comes along with the snapshot rows on purpose: for an access request
          // the raw payload is exactly the sort of thing the data principal is entitled
          // to see. It can be large — that is the honest answer, not a reason to hide it.
          snapshots: { orderBy: { scrapedAt: "desc" }, include: { score: true } },
        },
      }),
      // Campaign Post Tracking. Matched on `handle`, NOT `account_key` — that column is
      // platform-prefixed ("instagram:somehandle") and will never equal a bare handle, the
      // same trap called out for scout_candidates above.
      //
      // An influencer whose post was tracked has their handle, display name, post captions
      // and per-scan engagement history stored here, so this must be part of any access or
      // deletion request. `raw` rides along with the snapshots for the same reason it does
      // for Scoutline: for an access request the payload is exactly what the data principal
      // is entitled to see.
      prisma.trackedAccount.findMany({
        where: { handle: insensitive },
        include: {
          snapshots: { orderBy: { capturedAt: "desc" } },
          // Resolved to its name rather than left as a UUID. The category is a judgement
          // the operator recorded ABOUT this person ("Movie Critic"), so an access request
          // should return the word, not an id that means nothing to them.
          category: { select: { name: true } },
          // Subscriptions matter for a DELETION request specifically: deleting this
          // person's posts without deactivating the subscription means the next discovery
          // pass simply re-adds them.
          subscriptions: { include: { campaign: { select: { id: true, name: true } } } },
          trackedPosts: {
            include: {
              campaign: { select: { id: true, name: true } },
              snapshots: { orderBy: { capturedAt: "desc" } },
            },
          },
        },
      }),
    ]);

  const scoutEntries = candidates.flatMap((c) => c.batchEntries);
  const scoutSnapshots = candidates.flatMap((c) => c.snapshots);
  const trackedPosts = trackedAccounts.flatMap((a) => a.trackedPosts);

  return {
    mode: "handle",
    handle,
    searched: describe(HANDLE_TABLES),
    summary: {
      ownPosts: ownPosts.length,
      commentsMade: comments.length,
      commentSentimentRows: sentimentRows.length,
      competitorAccountRows: competitor.length,
      fanPageRows: fanPage.length,
      followerHistoryRows: followerHistory.length,
      scoutCandidateRows: candidates.length,
      scoutBatchEntryRows: scoutEntries.length,
      scoutSnapshotRows: scoutSnapshots.length,
      scoutScoreRows: scoutSnapshots.filter((s) => s.score).length,
      trackedAccountRows: trackedAccounts.length,
      trackedAccountSnapshotRows: trackedAccounts.flatMap((a) => a.snapshots).length,
      trackedPageSubscriptionRows: trackedAccounts.flatMap((a) => a.subscriptions).length,
      trackedPostRows: trackedPosts.length,
      trackedPostSnapshotRows: trackedPosts.flatMap((p) => p.snapshots).length,
    },
    ownPosts,
    comments,
    commentSentiment: sentimentRows,
    competitor,
    fanPage,
    followerHistory,
    scoutCandidates: candidates,
    trackedAccounts,
  };
}

async function lookupByName(name) {
  // `contains`, not `equals`: supplied_name is typed by hand into a source sheet, so
  // exact match would miss far more than it finds ("Priya Sharma " / "priya sharma").
  const insensitive = { contains: name, mode: "insensitive" };

  const [entries, competitor, fanPage] = await Promise.all([
    prisma.scoutBatchEntry.findMany({
      where: { suppliedName: insensitive },
      include: {
        candidate: true,
        batch: { select: { id: true, fileName: true, createdAt: true, archivedAt: true } },
      },
    }),
    prisma.competitorAccount.findMany({ where: { displayName: insensitive } }),
    prisma.fanPage.findMany({ where: { displayName: insensitive } }),
  ]);

  const handles = [
    ...new Set([
      ...entries.map((e) => e.candidate.handle),
      ...competitor.map((c) => c.igHandle),
      ...fanPage.map((f) => f.igHandle),
    ]),
  ];

  return {
    mode: "name",
    name,
    searched: describe(NAME_TABLES),
    // The whole point of surfacing these: a name search cannot reach anything keyed by
    // handle (posts, comments, sentiment, follower history, scout snapshots). Re-run in
    // handle mode for each of these before concluding anything about what is held.
    handlesFound: handles,
    nextStep: handles.length
      ? `Names are not a key in this schema. Re-run in handle mode for each handle above to see everything actually held: ${handles
          .map((h) => `npm run data-rights:lookup -- ${h}`)
          .join(" && ")}`
      : "No name matched. Names are only stored on the three tables listed under `searched` — a person held only as a handle is NOT findable by name, so this empty result does not mean no data is held. If you have any handle for them, re-run in handle mode.",
    summary: {
      scoutBatchEntryRows: entries.length,
      competitorAccountRows: competitor.length,
      fanPageRows: fanPage.length,
    },
    scoutBatchEntries: entries,
    competitor,
    fanPage,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const nameFlag = argv.indexOf("--name");
  const usage =
    "Usage:\n" +
    "  node --env-file=.env.local scripts/lookup-personal-data.mjs <handle>\n" +
    '  node --env-file=.env.local scripts/lookup-personal-data.mjs --name "Some Person"';

  let result;
  if (nameFlag !== -1) {
    const name = argv[nameFlag + 1]?.trim();
    if (!name) {
      console.error(usage);
      process.exit(1);
    }
    result = await lookupByName(name);
  } else {
    const raw = argv[0];
    if (!raw) {
      console.error(usage);
      process.exit(1);
    }
    result = await lookupByHandle(normalizeHandle(raw));
  }

  // scoutScoreRows counts a subset of scoutSnapshotRows (one score per snapshot at most),
  // so it is excluded here to keep this an honest row count rather than a double-count.
  // Only used to decide whether anything at all matched, but a number printed next to a
  // regulatory response should still be the number it claims to be.
  const total = Object.entries(result.summary)
    .filter(([key]) => key !== "scoutScoreRows")
    .reduce((sum, [, count]) => sum + count, 0);
  console.log(JSON.stringify({ ...result, totalRowsFound: total }, null, 2));

  if (total === 0) {
    // Deliberately on stderr and in words: the JSON above is what gets pasted into a
    // response, and "we searched N tables and found nothing" is a materially different
    // statement from "we hold nothing". Only the first one is something this script can
    // actually support, and only for the tables it knows about.
    console.error(
      `\nNo rows found. This means: searched ${result.searched.length} table(s) — ` +
        `${result.searched.map((s) => s.table).join(", ")} — and matched nothing.\n` +
        "It does NOT establish that no personal data is held. Check the coverage table in " +
        "DATA-PRIVACY.md for anything added since this script was last extended.",
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
