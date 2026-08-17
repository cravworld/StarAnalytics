-- CreateEnum
CREATE TYPE "ScoutRunStatus" AS ENUM ('queued', 'running', 'done', 'error');

-- CreateTable
CREATE TABLE "scout_batches" (
    "id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "expected_count" INTEGER NOT NULL,
    "parsed_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scout_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scout_candidates" (
    "id" TEXT NOT NULL,
    "ig_handle" TEXT NOT NULL,
    "profile_url_key" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scout_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scout_batch_entries" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "row_number" INTEGER,
    "supplied_name" TEXT,
    "deliverable" TEXT,

    CONSTRAINT "scout_batch_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scout_runs" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "apify_run_id" TEXT NOT NULL,
    "dataset_id" TEXT NOT NULL,
    "status" "ScoutRunStatus" NOT NULL DEFAULT 'queued',
    "handle_count" INTEGER NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "scout_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scout_snapshots" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "followers" INTEGER,
    "followers_available" BOOLEAN NOT NULL,
    "posts_analyzed" INTEGER NOT NULL,
    "engagement_rate_pct" DOUBLE PRECISION,
    "comment_rate_pct" DOUBLE PRECISION,
    "consistency_score" DOUBLE PRECISION,
    "posting_frequency_per_week" DOUBLE PRECISION,
    "content_mix_clips_pct" DOUBLE PRECISION,
    "content_mix_carousel_pct" DOUBLE PRECISION,
    "content_mix_image_pct" DOUBLE PRECISION,
    "most_engaged_post_url" TEXT,
    "note" TEXT,
    "raw" JSONB NOT NULL,
    "scraped_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scout_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scout_scores" (
    "id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "buzz_factor" INTEGER NOT NULL,
    "reach_score" INTEGER,
    "engagement_score" INTEGER,
    "consistency_score" INTEGER,
    "content_mix_score" INTEGER,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scout_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scout_candidates_profile_url_key_key" ON "scout_candidates"("profile_url_key");

-- CreateIndex
CREATE UNIQUE INDEX "scout_batch_entries_batch_id_candidate_id_key" ON "scout_batch_entries"("batch_id", "candidate_id");

-- CreateIndex
CREATE INDEX "scout_runs_status_idx" ON "scout_runs"("status");

-- CreateIndex
CREATE INDEX "scout_snapshots_candidate_id_scraped_at_idx" ON "scout_snapshots"("candidate_id", "scraped_at");

-- CreateIndex
CREATE UNIQUE INDEX "scout_scores_snapshot_id_key" ON "scout_scores"("snapshot_id");

-- AddForeignKey
ALTER TABLE "scout_batch_entries" ADD CONSTRAINT "scout_batch_entries_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "scout_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scout_batch_entries" ADD CONSTRAINT "scout_batch_entries_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "scout_candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scout_runs" ADD CONSTRAINT "scout_runs_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "scout_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scout_snapshots" ADD CONSTRAINT "scout_snapshots_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "scout_candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scout_scores" ADD CONSTRAINT "scout_scores_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "scout_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
