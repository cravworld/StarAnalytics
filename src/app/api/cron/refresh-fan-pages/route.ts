// Frequent cron (see vercel.json) — refreshes a SMALL BATCH of the stalest tracked fan pages,
// comments included, so the data stays current without anyone holding a browser tab open.
//
// WHY A BATCH ON A FREQUENT SCHEDULE, AND NOT "REFRESH EVERYTHING HOURLY":
//
// One fan page is up to two Apify runs (profile, then post history) at DEFAULT_WAIT_MS each,
// plus a comment scrape. A single invocation that walks every tracked page therefore cannot fit
// in any function time limit once there are more than a couple of pages — that is exactly the
// wall the "Refresh all" button hit at 33 pages, where it was killed mid-loop and returned a 504.
// A cron hits the same wall, just silently. So this refreshes FAN_PAGE_REFRESH_BATCH pages per
// run and relies on the schedule to walk the list.
//
// Selection is `lastCheckedAt` ascending among pages past the TTL, so successive runs pick up
// where the last one left off with no cursor to store, and a run that IS killed changes nothing:
// the pages it did not reach keep their old lastCheckedAt and come back next time. Raising the
// batch size is the obvious "optimisation" and the one that breaks this — it trades the
// self-healing property for the timeout.
import { NextResponse } from "next/server";
import { refreshFanPagesBatch } from "@/lib/data/fanpages";
import { tryAcquireCronLock, releaseCronLock } from "@/lib/cronLock";

const LOCK_NAME = "refresh-fan-pages";

/**
 * Pages per run. Small deliberately — see the header. Two pages at their realistic (not
 * worst-case) durations sit well inside maxDuration; two pages at their absolute worst case do
 * not, and that is the case the self-healing selection above is designed to absorb.
 */
const BATCH_SIZE = Number(process.env.FAN_PAGE_REFRESH_BATCH) || 2;

export const maxDuration = 800;

/**
 * Longer than one run can take, so a killed invocation cannot leave the lock held. The TTL is
 * what actually releases it in that case — releaseCronLock below is best-effort and does not run
 * if the function is terminated rather than returning.
 */
const LOCK_TTL_SECONDS = 900;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Runs every few minutes, and one run can legitimately outlast its own interval on slow pages.
  // Without this, overlapping invocations would each pick the same stalest rows — the selection
  // is deterministic — and pay Apify twice for them.
  if (!(await tryAcquireCronLock(LOCK_NAME, LOCK_TTL_SECONDS))) {
    return NextResponse.json({ skipped: true, reason: "previous invocation still running" });
  }

  try {
    // No pre-flight quota check, matching poll-hashtags: refreshFanPages already opens its own
    // account-wide short-circuit the moment Apify reports the quota gone, so the first Instagram
    // page in a batch discovers it and the rest are reported as not-attempted rather than each
    // burning another doomed call. With a batch this small, that costs at most one failed call
    // per run. YouTube pages are unaffected either way — separate API, separate quota.
    const results = await refreshFanPagesBatch(BATCH_SIZE);
    return NextResponse.json({
      batchSize: BATCH_SIZE,
      attempted: results.length,
      refreshed: results.filter((r) => r.ok).length,
      posts: results.reduce((s, r) => s + (r.postCount ?? 0), 0),
      failures: results.filter((r) => !r.ok).map((r) => ({ handle: r.handle, error: r.error })),
    });
  } finally {
    await releaseCronLock(LOCK_NAME);
  }
}
