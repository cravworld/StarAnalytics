"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import {
  ingestTrackedPostUrls,
  refreshCampaignTracking,
  runPageDiscovery,
  setPostCampaignInclusion,
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
    return { added: 0, duplicates: 0, rejected: 0, pageSubscriptionIds: [], outcomes: [] };
  }

  // Awaited, not deferred with after(): the caller needs the per-URL outcomes to render
  // ("added", "already tracked", "that's a story link"). Deferring would return an empty
  // result and leave the operator with no idea whether their link was accepted.
  const result = await ingestTrackedPostUrls(campaignId, urls);

  // Page discovery is the one part that CANNOT be awaited. A single page yields up to
  // TRACKED_DISCOVERY_LIMIT (50) posts, each ~6 sequential queries through storeTrackedPost
  // plus a follower scrape — well past the request budget, and a timeout would leave
  // partial rows with no record of where it stopped. Subscribing is instant and is what the
  // operator gets told about; the posts land shortly after and appear on the next load.
  for (const subscriptionId of result.pageSubscriptionIds) {
    after(async () => {
      try {
        const discovered = await runPageDiscovery(subscriptionId);
        console.log(
          `page discovery ${subscriptionId}: found ${discovered.found}, added ${discovered.added} (${discovered.campaignPosts} campaign, ${discovered.otherPosts} other), ${discovered.alreadyTracked} already tracked`,
        );
      } catch (err) {
        // Already recorded on the subscription's lastError by runPageDiscovery, so the UI
        // can show it. Logged rather than rethrown: one failing page must not abandon the
        // others queued in this same submission.
        console.error(`page discovery failed for ${subscriptionId}:`, err);
      }
    });
  }

  revalidatePath(`/campaigns/tracker/${campaignId}`);
  revalidatePath("/campaigns/tracker");
  return result;
}

/**
 * "Count this one too" (or the reverse) on a page-discovered post.
 *
 * The whole point of storing non-matching posts rather than filtering them away: an
 * influencer who forgot the campaign hashtag is one click from being counted, and the
 * operator can see what they aren't counting.
 */
export async function setPostCampaignInclusionAction(
  campaignId: string,
  trackedPostId: string,
  include: boolean,
): Promise<void> {
  await requireSession();
  await setPostCampaignInclusion(trackedPostId, include);
  revalidatePath(`/campaigns/tracker/${campaignId}`);
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
