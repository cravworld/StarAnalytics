-- CreateEnum
CREATE TYPE "TheaterCampaignStatus" AS ENUM ('active', 'paused', 'archived');

-- CreateEnum
CREATE TYPE "BmsScanStatus" AS ENUM ('queued', 'running', 'done', 'partial', 'error');

-- CreateTable
CREATE TABLE "theater_campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "movie_name" TEXT NOT NULL,
    "status" "TheaterCampaignStatus" NOT NULL DEFAULT 'active',
    "bms_event_code" TEXT NOT NULL,
    "bms_source_url" TEXT,
    "target_city_codes" TEXT[],
    "screening_start_date" DATE,
    "screening_end_date" DATE,
    "scan_interval_minutes" INTEGER NOT NULL DEFAULT 90,
    "wide_open_alert_pct" INTEGER NOT NULL DEFAULT 80,
    "min_shows_for_alert" INTEGER NOT NULL DEFAULT 3,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "theater_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "theaters" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'bookmyshow',
    "venue_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city_code" TEXT NOT NULL,
    "city_name" TEXT NOT NULL,
    "chain_code" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "theaters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screenings" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "theater_id" TEXT NOT NULL,
    "bms_session_id" TEXT NOT NULL,
    "show_date" DATE NOT NULL,
    "show_date_time" TIMESTAMP(3) NOT NULL,
    "cut_off_at" TIMESTAMP(3),
    "language" TEXT,
    "format" TEXT,
    "price_bands" TEXT[],
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disappeared_at" TIMESTAMP(3),

    CONSTRAINT "screenings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_snapshots" (
    "id" TEXT NOT NULL,
    "screening_id" TEXT NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "avail_status" INTEGER,
    "demand_level" TEXT NOT NULL,
    "style_id" TEXT,
    "source_label" TEXT,
    "confidence" TEXT NOT NULL,
    "scan_run_id" TEXT NOT NULL,

    CONSTRAINT "availability_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bms_scan_runs" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "status" "BmsScanStatus" NOT NULL DEFAULT 'queued',
    "provider" TEXT NOT NULL DEFAULT 'apify',
    "apify_run_id" TEXT,
    "dataset_id" TEXT,
    "cities_requested" INTEGER NOT NULL DEFAULT 0,
    "cities_succeeded" INTEGER NOT NULL DEFAULT 0,
    "items_received" INTEGER NOT NULL DEFAULT 0,
    "theaters_stored" INTEGER NOT NULL DEFAULT 0,
    "screenings_stored" INTEGER NOT NULL DEFAULT 0,
    "snapshots_stored" INTEGER NOT NULL DEFAULT 0,
    "records_skipped" INTEGER NOT NULL DEFAULT 0,
    "records_unmapped" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "bms_scan_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bms_scan_city_results" (
    "id" TEXT NOT NULL,
    "scan_run_id" TEXT NOT NULL,
    "city_code" TEXT NOT NULL,
    "show_date" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "returned_city_code" TEXT,
    "venue_count" INTEGER NOT NULL DEFAULT 0,
    "show_count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "bms_scan_city_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "theater_campaigns_status_idx" ON "theater_campaigns"("status");

-- CreateIndex
CREATE INDEX "theaters_city_code_idx" ON "theaters"("city_code");

-- CreateIndex
CREATE UNIQUE INDEX "theaters_source_venue_code_key" ON "theaters"("source", "venue_code");

-- CreateIndex
CREATE INDEX "screenings_campaign_id_show_date_time_idx" ON "screenings"("campaign_id", "show_date_time");

-- CreateIndex
CREATE INDEX "screenings_theater_id_show_date_time_idx" ON "screenings"("theater_id", "show_date_time");

-- CreateIndex
CREATE UNIQUE INDEX "screenings_campaign_id_bms_session_id_show_date_key" ON "screenings"("campaign_id", "bms_session_id", "show_date");

-- CreateIndex
CREATE INDEX "availability_snapshots_screening_id_captured_at_idx" ON "availability_snapshots"("screening_id", "captured_at");

-- CreateIndex
CREATE UNIQUE INDEX "availability_snapshots_screening_id_scan_run_id_key" ON "availability_snapshots"("screening_id", "scan_run_id");

-- CreateIndex
CREATE INDEX "bms_scan_runs_campaign_id_started_at_idx" ON "bms_scan_runs"("campaign_id", "started_at");

-- CreateIndex
CREATE INDEX "bms_scan_runs_status_idx" ON "bms_scan_runs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "bms_scan_city_results_scan_run_id_city_code_show_date_key" ON "bms_scan_city_results"("scan_run_id", "city_code", "show_date");

-- AddForeignKey
ALTER TABLE "screenings" ADD CONSTRAINT "screenings_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "theater_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screenings" ADD CONSTRAINT "screenings_theater_id_fkey" FOREIGN KEY ("theater_id") REFERENCES "theaters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_snapshots" ADD CONSTRAINT "availability_snapshots_screening_id_fkey" FOREIGN KEY ("screening_id") REFERENCES "screenings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_snapshots" ADD CONSTRAINT "availability_snapshots_scan_run_id_fkey" FOREIGN KEY ("scan_run_id") REFERENCES "bms_scan_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bms_scan_runs" ADD CONSTRAINT "bms_scan_runs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "theater_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bms_scan_city_results" ADD CONSTRAINT "bms_scan_city_results_scan_run_id_fkey" FOREIGN KEY ("scan_run_id") REFERENCES "bms_scan_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

