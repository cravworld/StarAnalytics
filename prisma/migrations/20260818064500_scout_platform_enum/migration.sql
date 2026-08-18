-- Create Scoutline's own platform enum first, and move every Scout* column onto it, before
-- touching the shared Platform enum at all — this order matters: the first attempt at this
-- migration failed with "cannot drop type Platform_old because other objects depend on it"
-- because it tried to shrink Platform back to two values while scout_candidates/scout_runs/
-- scout_settings' platform columns still referenced it. Converting those three columns to
-- ScoutPlatform up front removes that dependency before the shared-enum shrink ever runs.
CREATE TYPE "ScoutPlatform" AS ENUM ('instagram', 'facebook');

ALTER TABLE "scout_candidates" DROP COLUMN "platform",
ADD COLUMN     "platform" "ScoutPlatform" NOT NULL DEFAULT 'instagram';

ALTER TABLE "scout_runs" DROP COLUMN "platform",
ADD COLUMN     "platform" "ScoutPlatform" NOT NULL DEFAULT 'instagram';

ALTER TABLE "scout_settings" DROP CONSTRAINT "scout_settings_pkey",
DROP COLUMN "platform",
ADD COLUMN     "platform" "ScoutPlatform" NOT NULL,
ADD CONSTRAINT "scout_settings_pkey" PRIMARY KEY ("platform");

-- Now shrink the shared Platform enum back to its original two values (facebook was added
-- in an earlier migration attempt, then this feature moved to ScoutPlatform instead — see
-- ScoutPlatform's own schema comment for why). No explicit BEGIN/COMMIT: Prisma's own
-- migrate-diff output included one, which nests inside the migration engine's own
-- transaction wrapping and was the actual cause of the very first apply attempt failing
-- ["current transaction is aborted"].
CREATE TYPE "Platform_new" AS ENUM ('instagram', 'youtube');
ALTER TABLE "public"."competitor_accounts" ALTER COLUMN "platform" DROP DEFAULT;
ALTER TABLE "public"."fan_pages" ALTER COLUMN "platform" DROP DEFAULT;
ALTER TABLE "public"."posts" ALTER COLUMN "platform" DROP DEFAULT;
ALTER TABLE "posts" ALTER COLUMN "platform" TYPE "Platform_new" USING ("platform"::text::"Platform_new");
ALTER TABLE "competitor_accounts" ALTER COLUMN "platform" TYPE "Platform_new" USING ("platform"::text::"Platform_new");
ALTER TABLE "fan_pages" ALTER COLUMN "platform" TYPE "Platform_new" USING ("platform"::text::"Platform_new");
ALTER TABLE "account_snapshots" ALTER COLUMN "platform" TYPE "Platform_new" USING ("platform"::text::"Platform_new");
ALTER TYPE "Platform" RENAME TO "Platform_old";
ALTER TYPE "Platform_new" RENAME TO "Platform";
DROP TYPE "public"."Platform_old";
ALTER TABLE "competitor_accounts" ALTER COLUMN "platform" SET DEFAULT 'instagram';
ALTER TABLE "fan_pages" ALTER COLUMN "platform" SET DEFAULT 'instagram';
ALTER TABLE "posts" ALTER COLUMN "platform" SET DEFAULT 'instagram';
