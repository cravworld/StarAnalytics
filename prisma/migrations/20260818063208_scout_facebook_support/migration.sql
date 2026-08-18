-- AlterEnum
ALTER TYPE "Platform" ADD VALUE 'facebook';

-- AlterTable
ALTER TABLE "scout_batches" DROP COLUMN "date_filter",
DROP COLUMN "post_type_filter",
DROP COLUMN "posts_to_analyze",
DROP COLUMN "skip_pinned_posts",
DROP COLUMN "weight_consistency",
DROP COLUMN "weight_content_mix",
DROP COLUMN "weight_engagement",
DROP COLUMN "weight_reach";

-- AlterTable
ALTER TABLE "scout_candidates" ADD COLUMN     "platform" "Platform" NOT NULL DEFAULT 'instagram';

-- AlterTable
ALTER TABLE "scout_runs" ADD COLUMN     "actor_factors" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "platform" "Platform" NOT NULL DEFAULT 'instagram',
ADD COLUMN     "weight_consistency" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
ADD COLUMN     "weight_content_mix" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
ADD COLUMN     "weight_engagement" DOUBLE PRECISION NOT NULL DEFAULT 0.45,
ADD COLUMN     "weight_reach" DOUBLE PRECISION NOT NULL DEFAULT 0.3;

-- AlterTable
ALTER TABLE "scout_settings" DROP CONSTRAINT "scout_settings_pkey",
DROP COLUMN "date_filter",
DROP COLUMN "id",
DROP COLUMN "post_type_filter",
DROP COLUMN "posts_to_analyze",
DROP COLUMN "skip_pinned_posts",
ADD COLUMN     "fb_caption_text" BOOLEAN,
ADD COLUMN     "fb_only_posts_newer_than" TEXT,
ADD COLUMN     "fb_results_limit" INTEGER,
ADD COLUMN     "ig_date_filter" TEXT,
ADD COLUMN     "ig_post_type_filter" TEXT,
ADD COLUMN     "ig_posts_to_analyze" INTEGER,
ADD COLUMN     "ig_skip_pinned_posts" BOOLEAN,
ADD COLUMN     "platform" "Platform" NOT NULL,
ALTER COLUMN "weight_engagement" DROP DEFAULT,
ALTER COLUMN "weight_reach" DROP DEFAULT,
ALTER COLUMN "weight_consistency" DROP DEFAULT,
ALTER COLUMN "weight_content_mix" DROP DEFAULT,
ADD CONSTRAINT "scout_settings_pkey" PRIMARY KEY ("platform");

