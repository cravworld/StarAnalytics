-- CreateTable
CREATE TABLE "campaign_buzz_snapshots" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "size_component" INTEGER NOT NULL,
    "sentiment_component" INTEGER,
    "momentum_component" INTEGER NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_buzz_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_buzz_snapshots_campaign_id_captured_at_idx" ON "campaign_buzz_snapshots"("campaign_id", "captured_at");

-- AddForeignKey
ALTER TABLE "campaign_buzz_snapshots" ADD CONSTRAINT "campaign_buzz_snapshots_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
