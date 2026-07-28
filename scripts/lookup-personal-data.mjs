// Read-only lookup for a DPDP access/correction/deletion request: given a social
// handle, find every row across the schema that references it. Run with:
//   node --env-file=.env.local scripts/lookup-personal-data.mjs <handle>
//
// This only reads — it does not delete anything. If a request needs fulfilling,
// review the output, decide what actually needs to go, and delete by id yourself
// (via `npm run db:studio` or a one-off script) rather than trusting this to do it.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function normalizeHandle(input) {
  return input.replace(/^@/, "").trim();
}

async function main() {
  const raw = process.argv[2];
  if (!raw) {
    console.error("Usage: node --env-file=.env.local scripts/lookup-personal-data.mjs <handle>");
    process.exit(1);
  }
  const handle = normalizeHandle(raw);

  const [ownPosts, comments, competitor, fanPage] = await Promise.all([
    prisma.post.findMany({
      where: { authorHandle: { equals: handle, mode: "insensitive" } },
      include: { sentiment: true },
    }),
    prisma.postComment.findMany({
      where: { authorHandle: { equals: handle, mode: "insensitive" } },
      include: { post: { select: { id: true, authorHandle: true, externalUrl: true } } },
    }),
    prisma.competitorAccount.findMany({
      where: { igHandle: { equals: handle, mode: "insensitive" } },
    }),
    prisma.fanPage.findMany({
      where: { igHandle: { equals: handle, mode: "insensitive" } },
    }),
  ]);

  console.log(JSON.stringify(
    {
      handle,
      summary: {
        ownPosts: ownPosts.length,
        commentsMade: comments.length,
        competitorAccountRows: competitor.length,
        fanPageRows: fanPage.length,
      },
      ownPosts,
      comments,
      competitor,
      fanPage,
    },
    null,
    2,
  ));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
