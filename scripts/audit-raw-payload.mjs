// DPDP data-minimization audit: what's actually inside posts.raw / post_comments.raw
// vs. what the app reads back out of it (currently: nothing — see DATA-PRIVACY.md).
// Reports field names and how often each appears, never field values, so this is
// safe to run and paste the output of even outside this database's normal access
// boundary — it's a structure report, not a data dump.
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

  await auditTable("posts.raw", posts);
  await auditTable("post_comments.raw", comments);

  console.log(
    "\nCross-check each field above against src/lib/data/*.ts and src/lib/providers/*.ts " +
    "— per DATA-PRIVACY.md, nothing currently reads these back out. Any field with no " +
    "code reference is a minimization candidate to strip at ingest time in " +
    "src/lib/providers/apify-public-content.ts, not just prune later."
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
