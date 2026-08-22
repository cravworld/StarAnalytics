-- AlterTable
ALTER TABLE "tracked_accounts" ADD COLUMN     "category_id" TEXT;

-- CreateTable
CREATE TABLE "tracked_account_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracked_account_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tracked_account_categories_name_key" ON "tracked_account_categories"("name");

-- CreateIndex
CREATE INDEX "tracked_accounts_category_id_idx" ON "tracked_accounts"("category_id");

-- AddForeignKey
ALTER TABLE "tracked_accounts" ADD CONSTRAINT "tracked_accounts_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "tracked_account_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Seed the operator's own five, verbatim from the ask, so the dropdown is usable the moment
-- the screen loads rather than starting empty. Every one of them is renameable and
-- deletable in the UI — deleting one drops its accounts back to Uncategorised (SET NULL
-- above), it never deletes an account.
--
-- ON CONFLICT DO NOTHING makes this re-runnable and, more to the point, means a name the
-- operator has already created by hand is left exactly as they made it.
INSERT INTO "tracked_account_categories" ("id", "name", "sort_order", "created_at") VALUES
  (gen_random_uuid(), 'Influencers',     10, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Vloggers',        20, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'FX Pages',        30, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Movie Reviewers', 40, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Movie Critics',   50, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
