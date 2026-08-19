-- Records when a comment scrape was last attempted for a post, so posts that can never
-- yield comments (private, deleted, comments disabled) stop being re-scraped forever.
-- Additive and nullable: existing rows read as "never attempted", which is the correct
-- starting state — they get exactly one attempt each, then stop.
ALTER TABLE "posts" ADD COLUMN "comments_scraped_at" TIMESTAMP(3);
