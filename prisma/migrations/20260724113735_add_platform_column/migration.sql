-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('instagram', 'youtube');

-- DropIndex
DROP INDEX "competitor_accounts_ig_handle_key";

-- DropIndex
DROP INDEX "fan_pages_ig_handle_key";

-- DropIndex
DROP INDEX "posts_ig_shortcode_key";

-- AlterTable
ALTER TABLE "competitor_accounts" ADD COLUMN     "platform" "Platform" NOT NULL DEFAULT 'instagram';

-- AlterTable
ALTER TABLE "fan_pages" ADD COLUMN     "platform" "Platform" NOT NULL DEFAULT 'instagram';

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "platform" "Platform" NOT NULL DEFAULT 'instagram';

-- CreateIndex
CREATE UNIQUE INDEX "competitor_accounts_platform_ig_handle_key" ON "competitor_accounts"("platform", "ig_handle");

-- CreateIndex
CREATE UNIQUE INDEX "fan_pages_platform_ig_handle_key" ON "fan_pages"("platform", "ig_handle");

-- CreateIndex
CREATE UNIQUE INDEX "posts_platform_ig_shortcode_key" ON "posts"("platform", "ig_shortcode");

