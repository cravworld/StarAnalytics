-- CreateTable
CREATE TABLE "comment_sentiment" (
    "post_comment_id" TEXT NOT NULL,
    "author_handle" TEXT,
    "label" "SentimentLabel" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "model" TEXT NOT NULL,
    "analyzed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_sentiment_pkey" PRIMARY KEY ("post_comment_id")
);

-- AddForeignKey
ALTER TABLE "comment_sentiment" ADD CONSTRAINT "comment_sentiment_post_comment_id_fkey" FOREIGN KEY ("post_comment_id") REFERENCES "post_comments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
