-- CreateTable
CREATE TABLE "cron_locks" (
    "name" TEXT NOT NULL,
    "locked_at" TIMESTAMP(3),

    CONSTRAINT "cron_locks_pkey" PRIMARY KEY ("name")
);
