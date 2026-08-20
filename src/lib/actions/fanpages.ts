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
 * Chunking is the client's job (see BULK_ADD_CHUNK_SIZE) because the time budget belongs to the
 * hosting page's maxDuration; the cap is enforced here because a Server Action is a public POST
 * endpoint and cannot trust the caller for the size of its own input.
 *
 * Comment scrape: opted in, exactly like the single-add path. Bulk is meant to be the same
 * operation as pressing "Add" N times, so a page added from a pasted list must end up with the
 * same data as a page added by hand — anything less would make where a page came from visible in
 * its comment panels, which is not a distinction anyone asked for.
 *
 * WHY THE SCRAPE IS AWAITED HERE RATHER THAN DEFERRED WITH `after()`:
 *
 * Every other path hands the sentiment pipeline to `after()` so the click returns as soon as the
 * page data lands. This one must not, and the reason is the lock, not the cost. The comment
 * scrape is guarded by a global COMMENT_SCRAPE_LOCK, and losing that lock is deliberately NOT an
 * error — the losing pass logs, falls back to caption-only, and moves on. Deferred, chunk N's
 * scrape would still be running when the client's next chunk arrives, so page 1 would get its
 * comments and pages 2..N would silently get none. That is the worst available outcome, because
 * "no comments stored" is indistinguishable downstream from "this page has no comments" — the
 * bulk path would look like it worked while quietly producing thinner data than the button it
 * replaces. Awaiting makes the client's already-sequential loop serialize the lock by
 * construction.
 *
 * The duration envelope is unchanged. `after()` work counts against the same function limit
 * anyway, and Instagram chunks are one handle, so a chunk does exactly what one press of the
 * single-add button already does: one page's scrape plus at most
 * APIFY_COMMENT_POSTS_PER_INVOCATION posts' comments. Awaiting only moves that work in front of
 * the response instead of behind it, which has the side benefit of making the client's per-page
 * progress readout honest about when a page is actually finished.
 */
export async function addFanPagesBulkAction(
  handles: string[],
  platform: PlatformId = "instagram",
  revalidate = true,
) {
  await requireSession();
  if (!Array.isArray(handles) || handles.length === 0) throw new Error("no handles given");
  if (handles.length > MAX_BULK_ADD_HANDLES) {
    throw new Error(`too many handles in one call (max ${MAX_BULK_ADD_HANDLES})`);
  }

  const { results, postIds } = await addFanPages(handles, platform);
  if (postIds.length > 0) await queueSentimentClassification(postIds, FAN_PAGE_SENTIMENT_OPTS);
  // Only the client's LAST chunk revalidates. Every other path here revalidates unconditionally
  // because it is one call per click; this one is called once per page in a run of N, and
  // revalidatePath does not just invalidate a cache — per the Server Actions guide, it makes the
  // action response carry a freshly rendered RSC payload for the whole route, "which the client
  // commits as a seeded navigation". Twelve pasted handles meant twelve full server re-renders
  // of /fan-pages *during* the run: twelve extra getFanPagesData passes against a 5-connection
  // pool while twelve scrapes are in flight, and twelve mid-run commits into the tree holding
  // the progress and result state this screen is trying to show. Refreshing once at the end
  // costs nothing in freshness — the route is dynamic, so there is no cached payload to go stale
  // in the meantime — and removes both problems.
  if (revalidate) revalidatePath("/fan-pages");
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
