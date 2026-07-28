"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createCampaign, getCampaignStream, trackHashtag } from "@/lib/data/campaigns";
import { queueSentimentClassification } from "@/lib/data/sentiment";
import { requireSession } from "@/lib/require-session";

export async function createCampaignAction(input: {
  name: string;
  status: "live" | "planned";
  hashtags: string[];
  startDate?: string;
  endDate?: string;
  type?: string;
}) {
  await requireSession();
  const campaign = await createCampaign(input);
  revalidatePath("/campaigns");

  // Auto-track every hashtag the campaign was created with — without this, a new
  // campaign sits at zero posts until someone separately searches each tag on the
  // Hashtag Search page, which isn't the workflow anyone actually expects. Queued
  // after the response so campaign creation itself stays fast; the live stream
  // picks up new posts on its next poll tick once scraping lands.
  after(async () => {
    for (const tag of campaign.hashtags) {
      try {
        const postIds = await trackHashtag(tag);
        await queueSentimentClassification(postIds);
      } catch (err) {
        // One hashtag failing (rate limit, actor error) shouldn't block the rest —
        // same discipline as the poll-hashtags cron.
        console.error(`auto-track failed for #${tag} on campaign ${campaign.id}:`, err);
      }
    }
  });

  return campaign;
}

export async function trackHashtagAction(tag: string) {
  await requireSession();
  const postIds = await trackHashtag(tag);
  // Comment-scrape + classify queued as a side effect of this ingestion path, not a manual
  // trigger the team has to remember to run — see AGENTS.md Phase 4 §B3.
  after(() => queueSentimentClassification(postIds));
  revalidatePath("/campaigns/hashtag");
}

// Poll target for LiveStream.tsx — replaced the Supabase Realtime subscription (which used
// the public NEXT_PUBLIC_SUPABASE_ANON_KEY) since RLS is enabled with zero policies on
// `posts`, so that key can't read anything and the old subscription silently never fired.
// This reuses the same auth + data layer as the rest of the app instead of standing up a
// second, separately-secured credential just for this one feature.
export async function getCampaignStreamAction(campaignId: string) {
  await requireSession();
  return getCampaignStream(campaignId);
}
