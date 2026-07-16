"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createCampaign, trackHashtag } from "@/lib/data/campaigns";
import { queueSentimentClassification } from "@/lib/data/sentiment";

export async function createCampaignAction(input: {
  name: string;
  status: "live" | "planned";
  hashtags: string[];
  startDate?: string;
  endDate?: string;
  type?: string;
}) {
  const campaign = await createCampaign(input);
  revalidatePath("/campaigns");
  return campaign;
}

export async function trackHashtagAction(tag: string) {
  const postIds = await trackHashtag(tag);
  // Comment-scrape + classify queued as a side effect of this ingestion path, not a manual
  // trigger the team has to remember to run — see AGENTS.md Phase 4 §B3.
  after(() => queueSentimentClassification(postIds));
  revalidatePath("/campaigns/hashtag");
}
