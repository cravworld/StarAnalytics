-- AlterTable
ALTER TABLE "scout_batches" ADD COLUMN     "date_filter" TEXT,
ADD COLUMN     "post_type_filter" TEXT NOT NULL DEFAULT 'all',
ADD COLUMN     "posts_to_analyze" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "skip_pinned_posts" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "weight_consistency" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
ADD COLUMN     "weight_content_mix" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
ADD COLUMN     "weight_engagement" DOUBLE PRECISION NOT NULL DEFAULT 0.4,
ADD COLUMN     "weight_reach" DOUBLE PRECISION NOT NULL DEFAULT 0.3;

-- CreateTable
CREATE TABLE "scout_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "posts_to_analyze" INTEGER NOT NULL DEFAULT 15,
    "post_type_filter" TEXT NOT NULL DEFAULT 'all',
    "skip_pinned_posts" BOOLEAN NOT NULL DEFAULT true,
    "date_filter" TEXT,
    "weight_engagement" DOUBLE PRECISION NOT NULL DEFAULT 0.4,
    "weight_reach" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "weight_consistency" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    "weight_content_mix" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scout_settings_pkey" PRIMARY KEY ("id")
);
