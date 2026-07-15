-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'team', 'agency_viewer');

-- CreateEnum
CREATE TYPE "PostSource" AS ENUM ('self', 'competitor', 'agency', 'fanpage', 'campaign');

-- CreateEnum
CREATE TYPE "ScrapeRunStatus" AS ENUM ('queued', 'running', 'done', 'error');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('live', 'planned');

-- CreateEnum
CREATE TYPE "SentimentLabel" AS ENUM ('pos', 'neu', 'neg');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'team',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL,
    "source" "PostSource" NOT NULL,
    "ig_shortcode" TEXT,
    "external_url" TEXT,
    "author_handle" TEXT,
    "media_type" TEXT,
    "caption" TEXT,
    "posted_at" TIMESTAMP(3),
    "scraped_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reach" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "saves" INTEGER,
    "shares" INTEGER,
    "campaign_id" TEXT,
    "agency_id" TEXT,
    "fan_page_id" TEXT,
    "competitor_id" TEXT,
    "raw" JSONB,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scrape_runs" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "ScrapeRunStatus" NOT NULL DEFAULT 'queued',
    "apify_run_id" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "item_count" INTEGER,
    "error" TEXT,

    CONSTRAINT "scrape_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL,
    "hashtags" TEXT[],
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "type" TEXT,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agencies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "colour_hex" TEXT NOT NULL,
    "campaign_id" TEXT,

    CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitor_accounts" (
    "id" TEXT NOT NULL,
    "ig_handle" TEXT NOT NULL,
    "display_name" TEXT,
    "followers" INTEGER,
    "added_by" TEXT,
    "last_scraped_at" TIMESTAMP(3),

    CONSTRAINT "competitor_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fan_pages" (
    "id" TEXT NOT NULL,
    "ig_handle" TEXT NOT NULL,
    "display_name" TEXT,
    "followers" INTEGER,
    "last_checked_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_verified_fan" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "fan_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_post_scores" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "perf_score" DOUBLE PRECISION NOT NULL,
    "auth_score" DOUBLE PRECISION NOT NULL,
    "eff_score" DOUBLE PRECISION NOT NULL,
    "total_score" DOUBLE PRECISION NOT NULL,
    "flags" JSONB NOT NULL,
    "threshold_config_version" INTEGER NOT NULL,
    "scored_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agency_post_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sentiment" (
    "post_id" TEXT NOT NULL,
    "label" "SentimentLabel" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "keywords" TEXT[],
    "model" TEXT NOT NULL,
    "analyzed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sentiment_pkey" PRIMARY KEY ("post_id")
);

-- CreateTable
CREATE TABLE "hashtag_snapshots" (
    "id" TEXT NOT NULL,
    "hashtag" TEXT NOT NULL,
    "snapshot_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "post_count" INTEGER NOT NULL,
    "avg_eng_rate" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "hashtag_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fan_page_id" TEXT,
    "campaign_id" TEXT,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),
    "channel" TEXT,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "threshold_configs" (
    "version" INTEGER NOT NULL,
    "params" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "threshold_configs_pkey" PRIMARY KEY ("version")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "posts_ig_shortcode_key" ON "posts"("ig_shortcode");

-- CreateIndex
CREATE UNIQUE INDEX "competitor_accounts_ig_handle_key" ON "competitor_accounts"("ig_handle");

-- CreateIndex
CREATE UNIQUE INDEX "fan_pages_ig_handle_key" ON "fan_pages"("ig_handle");

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_fan_page_id_fkey" FOREIGN KEY ("fan_page_id") REFERENCES "fan_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_competitor_id_fkey" FOREIGN KEY ("competitor_id") REFERENCES "competitor_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_post_scores" ADD CONSTRAINT "agency_post_scores_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_post_scores" ADD CONSTRAINT "agency_post_scores_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sentiment" ADD CONSTRAINT "sentiment_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_fan_page_id_fkey" FOREIGN KEY ("fan_page_id") REFERENCES "fan_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
