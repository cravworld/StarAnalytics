-- CreateTable
CREATE TABLE "account_snapshots" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "ig_handle" TEXT NOT NULL,
    "followers" INTEGER NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_snapshots_platform_ig_handle_captured_at_idx" ON "account_snapshots"("platform", "ig_handle", "captured_at");
