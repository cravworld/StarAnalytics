"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import {
  addFanPage,
  addFanPages,
  pullFanPageHistory,
  refreshFanPages,
  setFanPageVerified,
  stopTrackingFanPage,
} from "@/lib/data/fanpages";
import { queueSentimentClassification } from "@/lib/data/sentiment";
import { requireSession } from "@/lib/require-session";
import { MAX_BULK_ADD_HANDLES } from "@/lib/providers/handle-input";
import type { PlatformId } from "@/lib/providers/types";

// Comments are opted into explicitly on both fan-page paths below, so the detail screen's
// comment panels keep working while the global Comment Sentiment pipeline stays switched
// off (see isCommentScrapeEnabled). Same justification the agency report uses: a human
// clicked, and the scrape is bounded to one page's most recent posts rather than running
// unattended every hour. The fan-page CRON path deliberately does NOT pass this — it
// inherits the global default, so nothing scrapes comments on a schedule.
const FAN_PAGE_SENTIMENT_OPTS = { scrapeComments: true } as const;

export async function addFanPageAction(handle: string, platform: PlatformId = "instagram") {
  await requireSession();
  const postIds = await addFanPage(handle, platform);
  // Comment-scrape + classify queued as a side effect of the ingestion path rather than a
  // manual step someone has to remember — same discipline as trackHashtagAction. Deferred
  // with after() so adding a page returns as soon as the scrape lands, not after Claude
  // has classified everything it pulled.
  if (postIds.length > 0) after(() => queueSentimentClassification(postIds, FAN_PAGE_SENTIMENT_OPTS));
  revalidatePath("/fan-pages");
}

/**
 * Bulk add — one chunk of a pasted list of handles.
 *
 * DELIBERATELY DOES NOT PASS FAN_PAGE_SENTIMENT_OPTS. The opt-in above is justified by "a human
 * clicked, and the scrape is bounded to one page's most recent posts". Neither half survives a
 * bulk paste: one click now stands for an arbitrary number of pages, and the bound becomes
 * N × 50 posts. Handing that many post ids to classifyPostsForSentiment with comments forced on
 * is finding A of the Apify audit (unbounded comment fan-out) reintroduced by the side door — at
 * ~50 posts × 20 comments × $0.0023 it is roughly $2.30 per page against $0.08 for the profile
 * and post pull alone, a ~30x multiplier on a plan whose monthly cap is $29. So this path
 * inherits the global COMMENT_SCRAPE default like the cron does. Comments for a bulk-added page
 * are one press of "Refresh data" on its detail screen away, at a price the user chose to pay.
 *
 * Chunking is the client's job (see BULK_ADD_CHUNK_SIZE) because the time budget belongs to the
 * hosting page's maxDuration; the cap is enforced here because a Server Action is a public POST
 * endpoint and cannot trust the caller for the size of its own input.
 */
export async function addFanPagesBulkAction(handles: string[], platform: PlatformId = "instagram") {
  await requireSession();
  if (!Array.isArray(handles) || handles.length === 0) throw new Error("no handles given");
  if (handles.length > MAX_BULK_ADD_HANDLES) {
    throw new Error(`too many handles in one call (max ${MAX_BULK_ADD_HANDLES})`);
  }

  const { results, postIds } = await addFanPages(handles, platform);
  if (postIds.length > 0) after(() => queueSentimentClassification(postIds));
  revalidatePath("/fan-pages");
  return {
    results,
    added: results.filter((r) => r.ok && r.status === "added").length,
    reactivated: results.filter((r) => r.ok && r.status === "reactivated").length,
    alreadyTracked: results.filter((r) => r.ok && r.status === "already-tracked").length,
    posts: results.reduce((s, r) => s + (r.postCount ?? 0), 0),
    failures: results.filter((r) => !r.ok).map((r) => ({ handle: r.handle, error: r.error ?? "unknown error" })),
  };
}

// The detail screen's refresh. Re-pulls the page's profile and its 50 most recent posts,
// then classifies whatever came back. Instagram spends a real Apify call here, which is
// exactly why it is a button and not something a page render can trigger.
export async function pullFanPageHistoryAction(id: string) {
  await requireSession();
  const { postCount, postIds } = await pullFanPageHistory(id);
  if (postIds.length > 0) after(() => queueSentimentClassification(postIds, FAN_PAGE_SENTIMENT_OPTS));
  revalidatePath("/fan-pages");
  revalidatePath(`/fan-pages/${id}`);
  return { postCount };
}

/**
 * "Refresh all" on the Fan Pages list — the same pull the per-page button does, run across
 * every tracked page so nobody has to open them one at a time.
 *
 * Forced rather than TTL-gated: someone pressing this wants current numbers, and quietly
 * skipping the pages that were checked an hour ago would look like the button did nothing.
 * Runs sequentially and returns a per-page outcome, so one page failing (a dead handle, a
 * rate limit) neither aborts the rest nor gets reported as success — the same discipline the
 * cron uses, because it is literally the same loop.
 */
export async function refreshAllFanPagesAction() {
  await requireSession();
  const results = await refreshFanPages({ force: true, sentimentOpts: FAN_PAGE_SENTIMENT_OPTS });
  revalidatePath("/fan-pages");
  // One literal path per refreshed page, rather than the `("/fan-pages/[id]", "page")` route
  // pattern this used to pass. The pattern form builds its cache tag from the string as
  // given, and this route really lives at `(app)/fan-pages/[id]` — whether the tag needs the
  // route group in it is exactly the kind of thing that fails silently, leaving detail pages
  // stale after a refresh with nothing to notice. Literal paths have no such ambiguity, are
  // what every other call site in this codebase uses, and are available now that the results
  // carry ids.
  for (const r of results) revalidatePath(`/fan-pages/${r.id}`);
  return {
    total: results.length,
    refreshed: results.filter((r) => r.ok).length,
    posts: results.reduce((s, r) => s + (r.postCount ?? 0), 0),
    failures: results.filter((r) => !r.ok).map((r) => ({ handle: r.handle, error: r.error ?? "unknown error" })),
  };
}

export async function setFanPageVerifiedAction(id: string, isVerifiedFan: boolean) {
  await requireSession();
  await setFanPageVerified(id, isVerifiedFan);
  revalidatePath("/fan-pages");
  revalidatePath(`/fan-pages/${id}`);
}

export async function stopTrackingFanPageAction(id: string) {
  await requireSession();
  await stopTrackingFanPage(id);
  revalidatePath("/fan-pages");
  revalidatePath(`/fan-pages/${id}`);
}
