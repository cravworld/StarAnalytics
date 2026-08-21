"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import {
  ingestTrackedPostUrls,
  refreshCampaignTracking,
  type IngestResult,
} from "@/lib/data/trackedPosts";
import { requireSession } from "@/lib/require-session";

// A Server Action is a public POST endpoint, so the batch size is capped here rather than
// trusted from the caller — same reasoning as MAX_BULK_ADD_HANDLES on the fan-page path.
// Matched to the scrape batch size so one submission is at most one actor run.
const MAX_URLS_PER_SUBMIT = 200;

export async function addTrackedPostsAction(
  campaignId: string,
  rawUrls: string,
): Promise<IngestResult> {
  await requireSession();

  // Split on newlines, commas and whitespace so a pasted column from a sheet works as-is.
  // The UI passes one URL today; this costs nothing and means the bulk path (Phase 3) is a
  // parser in front of the same function rather than a second pipeline.
  const urls = rawUrls
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter(Boolean)
    .slice(0, MAX_URLS_PER_SUBMIT);

  if (urls.length === 0) {
    return { added: 0, duplicates: 0, rejected: 0, outcomes: [] };
  }

  // Awaited, not deferred with after(): the caller needs the per-URL outcomes to render
  // ("added", "already tracked", "that's a story link"). Deferring would return an empty
  // result and leave the operator with no idea whether their link was accepted.
  const result = await ingestTrackedPostUrls(campaignId, urls);
  revalidatePath(`/campaigns/tracker/${campaignId}`);
  revalidatePath("/campaigns/tracker");
  return result;
}

/**
 * Re-scrape every tracked post in the campaign.
 *
 * Deferred with after() because this is a bounded-but-slow Apify/YouTube pass over every
 * post in the campaign, and the click should return immediately. The page re-reads the
 * refreshed numbers on its next load; the run itself records per-post errors on
 * TrackedPost.lastError rather than failing silently.
 */
export async function refreshTrackedPostsAction(campaignId: string): Promise<void> {
  await requireSession();
  after(async () => {
    try {
      const { refreshed, failed } = await refreshCampaignTracking(campaignId);
      console.log(`tracked posts refresh (campaign ${campaignId}): ${refreshed} refreshed, ${failed} failed`);
    } catch (err) {
      console.error(`tracked posts refresh failed for campaign ${campaignId}:`, err);
    }
  });
  revalidatePath(`/campaigns/tracker/${campaignId}`);
}
