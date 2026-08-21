-- Campaign Post Tracking — see CAMPAIGN-POST-TRACKING.md
--
-- Purely additive: one new enum, four new tables. No existing table, column, index or
-- constraint is altered or dropped. The Campaign relation is a Prisma-side back-reference
-- only — the FK lives on tracked_posts, so `campaigns` is untouched by this migration.

-- CreateEnum
CREATE TYPE "TrackPlatform" AS ENUM ('instagram', 'facebook', 'youtube');

-- CreateTable
CREATE TABLE "tracked_accounts" (
    "id" TEXT NOT NULL,
    "platform" "TrackPlatform" NOT NULL,
    "handle" TEXT NOT NULL,
    "display_name" TEXT,
    "account_key" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scout_candidate_id" TEXT,

    CONSTRAINT "tracked_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracked_account_snapshots" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "followers" INTEGER,
    "followers_available" BOOLEAN NOT NULL DEFAULT true,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB,

    CONSTRAINT "tracked_account_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracked_posts" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "platform" "TrackPlatform" NOT NULL,
    "url" TEXT NOT NULL,
    "post_key" TEXT NOT NULL,
    "media_type" TEXT,
    "caption" TEXT,
    "posted_at" TIMESTAMP(3),
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_scraped_at" TIMESTAMP(3),
    "last_error" TEXT,
    "cur_likes" INTEGER,
    "cur_comments" INTEGER,
    "cur_shares" INTEGER,
    "cur_views" INTEGER,
    "prev_likes" INTEGER,
    "prev_comments" INTEGER,
    "prev_views" INTEGER,

    CONSTRAINT "tracked_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracked_post_snapshots" (
    "id" TEXT NOT NULL,
    "tracked_post_id" TEXT NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "views" INTEGER,
    "reactions" JSONB,
    "raw" JSONB,

    CONSTRAINT "tracked_post_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tracked_accounts_account_key_key" ON "tracked_accounts"("account_key");

-- CreateIndex
CREATE INDEX "tracked_account_snapshots_account_id_captured_at_idx" ON "tracked_account_snapshots"("account_id", "captured_at");

-- CreateIndex
CREATE INDEX "tracked_posts_campaign_id_account_id_idx" ON "tracked_posts"("campaign_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "tracked_posts_platform_post_key_key" ON "tracked_posts"("platform", "post_key");

-- CreateIndex
CREATE INDEX "tracked_post_snapshots_tracked_post_id_captured_at_idx" ON "tracked_post_snapshots"("tracked_post_id", "captured_at");

-- AddForeignKey
ALTER TABLE "tracked_account_snapshots" ADD CONSTRAINT "tracked_account_snapshots_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "tracked_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracked_posts" ADD CONSTRAINT "tracked_posts_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracked_posts" ADD CONSTRAINT "tracked_posts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "tracked_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracked_post_snapshots" ADD CONSTRAINT "tracked_post_snapshots_tracked_post_id_fkey" FOREIGN KEY ("tracked_post_id") REFERENCES "tracked_posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
