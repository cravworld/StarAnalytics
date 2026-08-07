// Removes the `E2E Agency N` rows that e2e/phase3-agency-verify.spec.ts left behind in
// production. That spec drives the real upload flow against the real DATABASE_URL (see
// playwright.config.ts — only DATA_MODE_* is mocked, never the database) and had no
// cleanup, so every local `npm run test:e2e` planted three more agency rows that then
// showed up in the app's own Agency Report as if they were clients.
//
// The spec now cleans up after itself (test.afterAll), so this is a one-off for rows
// created before that fix. Safe to re-run: it is a no-op once they are gone.
//
// Usage:
//   node --env-file=.env.local scripts/purge-e2e-agencies.mjs          # report only
//   node --env-file=.env.local scripts/purge-e2e-agencies.mjs --apply  # delete
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

// Anchored to the exact shape the spec generates (`E2E Agency ${i % 3}`) rather than a
// loose "E2E" contains-match, so a real agency that happens to have those letters in its
// name can never be caught by this.
const E2E_AGENCY_NAME = /^E2E Agency \d+$/;

async function main() {
  const all = await prisma.agency.findMany({ select: { id: true, name: true } });
  const targets = all.filter((a) => E2E_AGENCY_NAME.test(a.name));

  if (targets.length === 0) {
    console.log(`No E2E agency rows found. ${all.length} agencies in the database, all real.`);
    return;
  }

  // Re-checked here rather than trusted from an earlier survey: Agency has FK children
  // (Post.agencyId, AgencyPostScore.agencyId) and a delete that would orphan real scored
  // data must fail loudly instead of cascading.
  const ids = targets.map((t) => t.id);
  const [posts, scores] = await Promise.all([
    prisma.post.count({ where: { agencyId: { in: ids } } }),
    prisma.agencyPostScore.count({ where: { agencyId: { in: ids } } }),
  ]);

  console.log(`Matched ${targets.length} E2E agency rows: ${targets.map((t) => t.name).join(", ")}`);
  console.log(`Linked posts: ${posts}   Linked scores: ${scores}`);

  if (posts > 0 || scores > 0) {
    console.error(
      "\nABORTED — these rows have dependent data. That is not the pollution pattern this " +
        "script was written for; inspect before deleting anything by hand.",
    );
    process.exitCode = 1;
    return;
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to delete.");
    return;
  }

  const { count } = await prisma.agency.deleteMany({ where: { id: { in: ids } } });
  console.log(`\nDeleted ${count} agency rows. ${await prisma.agency.count()} agencies remain.`);
  // Deliberately leaves the `agency_batch` rows in scrape_runs alone: those are the audit
  // trail of runs that genuinely happened, and src/lib/apify/quotaBreaker.ts already
  // ignores them for pipeline-health purposes (they carry no apify_run_id).
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
