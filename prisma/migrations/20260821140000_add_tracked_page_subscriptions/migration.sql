-- Campaign Post Tracking: whole-page subscriptions — see CAMPAIGN-POST-TRACKING.md §13.
--
-- Additive only. One new table, plus three new nullable/defaulted columns on tracked_posts.
-- The defaults are chosen so every existing row keeps its current meaning: posts already
-- tracked were all pasted by hand, which is exactly what is_campaign_post = true and
-- discovered_via = 'pasted' assert.

-- CreateTable
CREATE TABLE "tracked_page_subscriptions" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_discovery_at" TIMESTAMP(3),
    "last_error" TEXT,
    "discover_from" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracked_page_subscriptions_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "tracked_posts" ADD COLUMN     "discovered_via" TEXT NOT NULL DEFAULT 'pasted',
ADD COLUMN     "included_by_user_at" TIMESTAMP(3),
ADD COLUMN     "is_campaign_post" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "tracked_page_subscriptions_is_active_last_discovery_at_idx" ON "tracked_page_subscriptions"("is_active", "last_discovery_at");

-- CreateIndex
CREATE UNIQUE INDEX "tracked_page_subscriptions_campaign_id_account_id_key" ON "tracked_page_subscriptions"("campaign_id", "account_id");

-- AddForeignKey
ALTER TABLE "tracked_page_subscriptions" ADD CONSTRAINT "tracked_page_subscriptions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracked_page_subscriptions" ADD CONSTRAINT "tracked_page_subscriptions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "tracked_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
