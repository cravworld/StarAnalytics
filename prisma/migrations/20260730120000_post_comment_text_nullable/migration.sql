-- Structured-data retention policy (DATA-PRIVACY.md "Retention" / Open items #2):
-- post_comments.text and .author_handle are nulled out by the prune-raw-payloads
-- cron once a row is older than COMMENT_RETENTION_DAYS, so the column can no
-- longer be NOT NULL. Additive, non-destructive: existing rows keep their value
-- until the cron actually clears them.
ALTER TABLE "post_comments" ALTER COLUMN "text" DROP NOT NULL;
