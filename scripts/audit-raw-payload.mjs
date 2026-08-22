// DPDP data-minimization audit: what's actually inside posts.raw / post_comments.raw /
// scout_snapshots.raw vs. what the app reads back out of them. posts.raw has six SQL
// readers across two fields (`hashtags`, `mentions`) — this header used to say "currently:
// nothing", which was wrong; see DATA-PRIVACY.md open item 5. The other two columns do
// still have no reader. Reports field names and how often each appears, never field values,
// so this is safe to run and paste the output of even outside this database's normal
// access boundary — it's a structure report, not a data dump.
//
// Covers the same three columns the prune-raw-payloads cron clears, deliberately: this
// script is how you decide what to strip at ingest, and that question only makes sense
// for a column someone is already retaining. If the two lists ever drift apart again,
// they are both wrong.
//
// Usage: node --env-file=.env.local scripts/audit-raw-payload.mjs [sampleSize]
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const SAMPLE_SIZE = Number(process.argv[2]) || 200;

function collectKeys(obj, prefix, into) {
  if (!obj || typeof obj !== "object") return;
  for (const key of Object.keys(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    into.set(path, (into.get(path) || 0) + 1);
    const value = obj[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      collectKeys(value, path, into);
    }
  }
}

async function auditTable(label, rows) {
  const keyCounts = new Map();
  let sampled = 0;
  for (const row of rows) {
    if (!row.raw) continue;
    sampled++;
    collectKeys(row.raw, "", keyCounts);
  }

  console.log(`\n=== ${label}: ${sampled} rows with a non-null raw payload ===`);
  if (sampled === 0) {
    console.log("(nothing to report)");
    return;
  }
  const sorted = [...keyCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [key, count] of sorted) {
    const pct = Math.round((count / sampled) * 100);
    console.log(`  ${key.padEnd(40)} present in ${count}/${sampled} (${pct}%)`);
  }
}

async function main() {
  const posts = await prisma.post.findMany({
    orderBy: { scrapedAt: "desc" },
    take: SAMPLE_SIZE,
    select: { raw: true },
  });
  const comments = await prisma.postComment.findMany({
    orderBy: { scrapedAt: "desc" },
    take: SAMPLE_SIZE,
    select: { raw: true },
  });
  // Split by platform rather than audited as one column, because two different actors
  // write into it: easy_scraper/instagram-profile-engagement-analytics uses snake_case
  // (`profile_username`, `followers_count`) and apify/facebook-pages-scraper uses
  // camelCase (`pageName`, `likes`). Reported together, the union would show almost
  // every field sitting near 50% present and mean nothing — the percentages are only
  // interpretable within one actor's shape. Platform lives on the candidate, not the
  // snapshot, hence the join.
  const scoutSnapshots = await prisma.scoutSnapshot.findMany({
    orderBy: { scrapedAt: "desc" },
    take: SAMPLE_SIZE,
    select: { raw: true, candidate: { select: { platform: true } } },
  });

  await auditTable("posts.raw", posts);
  await auditTable("post_comments.raw", comments);
  for (const platform of ["instagram", "facebook"]) {
    await auditTable(
      `scout_snapshots.raw (${platform})`,
      scoutSnapshots.filter((s) => s.candidate.platform === platform),
    );
  }

  console.log(
    "\nCross-check each field above against src/lib/data/*.ts and src/lib/providers/*.ts " +
    "— per DATA-PRIVACY.md, nothing currently reads these back out. Any field with no " +
    "code reference is a minimization candidate to strip at ingest time rather than just " +
    "prune later: posts/comments in src/lib/providers/apify-public-content.ts, Scoutline " +
    "in apify-scout-normalize.ts (Instagram) and apify-scout-normalize-facebook.ts " +
    "(Facebook), both of which currently keep the whole actor item as `raw: item`.\n\n" +
    `Sampling note: the ${SAMPLE_SIZE}-row limit is applied per table, and for Scoutline ` +
    "it is applied BEFORE the platform split — so if one platform dominates recent runs " +
    "the other's section is drawn from whatever few rows fell inside the window. Trust " +
    "the per-section row count above the percentages, and raise the sample size if a " +
    "section looks thin. Rows whose payload has already been pruned to null are skipped, " +
    "so this reports on retained data only, which is the population that matters here."
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
