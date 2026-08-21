// Picks up new posts from subscribed campaign pages — see CAMPAIGN-POST-TRACKING.md §13.
//
// This is what makes a page subscription worth more than pasting links: the operator pastes
// an influencer's page once, and anything they post afterwards arrives on its own.
//
// WHY A SMALL BATCH ON A FREQUENT SCHEDULE, rather than "scan every page hourly": one page
// is a full Apify run (up to TRACKED_DISCOVERY_LIMIT posts), so one invocation walking every
// subscription cannot fit in any function time limit once there are more than a handful.
// That is the same wall "Refresh all" hit at 33 fan pages, and a cron hits it silently.
// Selection is lastDiscoveryAt-ascending, so successive runs continue where the last stopped
// with no cursor to store, and a killed run changes nothing: pages it never reached keep
// their old timestamp and come back next time. Raising the batch size is the obvious
// "optimisation" and the one that trades that self-healing property for a timeout.
import { NextResponse } from "next/server";
import { discoverStalePages } from "@/lib/data/trackedPosts";
import { tryAcquireCronLock, releaseCronLock } from "@/lib/cronLock";

const LOCK_NAME = "discover-tracked-pages";

/** Pages per run. Small deliberately — see the header. */
const BATCH_SIZE = Number(process.env.PAGE_DISCOVERY_BATCH) || 2;

export const maxDuration = 800;

/**
 * Longer than one run can take, so a killed invocation cannot leave the lock held — the TTL
 * is what releases it in that case, since releaseCronLock below is best-effort and does not
 * run if the function is terminated rather than returning.
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

  // One run can legitimately outlast its own interval on a slow page. Without the lock,
  // overlapping invocations would each select the same stalest rows — the ordering is
  // deterministic — and pay Apify twice for them.
  if (!(await tryAcquireCronLock(LOCK_NAME, LOCK_TTL_SECONDS))) {
    return NextResponse.json({ skipped: true, reason: "previous invocation still running" });
  }

  try {
    const result = await discoverStalePages(BATCH_SIZE);
    return NextResponse.json({ ...result, batchSize: BATCH_SIZE });
  } finally {
    await releaseCronLock(LOCK_NAME);
  }
}
