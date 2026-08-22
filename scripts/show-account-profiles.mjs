// What do the tracked accounts say about themselves?
//
// The measurement step for account categories (CAMPAIGN-POST-TRACKING.md §14h): before
// building anything that SUGGESTS a category, look at whether the accounts' own words
// actually separate a reviewer from a vlogger from an edit page.
//
// Read-only. Prints what is already stored — no scraping, no API calls, no spend. Run it
// after a refresh has populated the bios:
//
//   node --env-file=.env.local scripts/show-account-profiles.mjs
//   node --env-file=.env.local scripts/show-account-profiles.mjs --missing
//
// --missing lists only the accounts with no profile text, which is the number that decides
// whether a suggester is worth building at all.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const onlyMissing = process.argv.includes("--missing");

const accounts = await prisma.trackedAccount.findMany({
  select: {
    platform: true,
    handle: true,
    displayName: true,
    bio: true,
    platformCategory: true,
    profileTextAt: true,
    category: { select: { name: true } },
  },
  orderBy: [{ platform: "asc" }, { handle: "asc" }],
});

// Three states, not two. "never looked" is a scraping gap to fix; "looked, blank" is a fact
// about the account and no amount of re-scraping will change it. Collapsing them would make
// a broken field name look like a population of quiet accounts.
const neverRead = accounts.filter((a) => a.bio === null);
const blank = accounts.filter((a) => a.bio === "");
const withText = accounts.filter((a) => a.bio !== null && a.bio !== "");

console.log(`${accounts.length} tracked accounts`);
console.log(`  ${withText.length} with profile text`);
console.log(`  ${blank.length} read, but blank`);
console.log(`  ${neverRead.length} never read (no refresh since the column existed)\n`);

const rows = onlyMissing ? [...neverRead, ...blank] : accounts;
for (const a of rows) {
  const name = (a.displayName || a.handle).slice(0, 26).padEnd(26);
  const filed = a.category?.name ?? "unfiled";
  const text =
    a.bio === null ? "(never read)" : a.bio === "" ? "(blank)" : a.bio.replace(/\s+/g, " ").slice(0, 84);
  console.log(`${a.platform.padEnd(9)} ${name} [${filed}] ${a.platformCategory ? `{${a.platformCategory}} ` : ""}${text}`);
}

await prisma.$disconnect();
