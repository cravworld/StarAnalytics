-- AlterTable
ALTER TABLE "tracked_accounts" ADD COLUMN     "bio" TEXT,
ADD COLUMN     "platform_category" TEXT,
ADD COLUMN     "profile_text_at" TIMESTAMP(3);


-- Backfill the YouTube channel descriptions we ALREADY hold.
--
-- fetchYouTubeChannelById has been storing the full channels.list response in
-- tracked_account_snapshots.raw all along, and snippet.description is sitting in it. Reading
-- it out here means the 31 tracked channels have their text the moment this migration runs,
-- with no re-scrape and no API call — which matters because Apify is blocked for billing
-- and a re-scrape is not currently possible for anything.
--
-- Only the newest snapshot per account, and only where raw survived the prune cron.
-- profile_text_at is set from that snapshot's capture time, NOT now(): the text is as old as
-- the scrape it came from, and stamping it as fresh would misreport when we last looked.
UPDATE "tracked_accounts" a
SET "bio" = latest.descr,
    "profile_text_at" = latest.captured_at
FROM (
  SELECT DISTINCT ON (s.account_id)
         s.account_id,
         s.captured_at,
         s.raw::jsonb #>> '{snippet,description}' AS descr
  FROM "tracked_account_snapshots" s
  WHERE s.raw IS NOT NULL
  ORDER BY s.account_id, s.captured_at DESC
) AS latest
WHERE latest.account_id = a.id
  AND latest.descr IS NOT NULL;
