// Weekly cron (see vercel.json, "0 9 * * 1" — Monday mornings) — sends one consolidated
// digest email across every live campaign instead of someone having to open the dashboard
// to check. Same CRON_SECRET bearer-auth gate every other cron route in this project uses.
import { NextResponse } from "next/server";
import { sendWeeklyDigest } from "@/lib/data/weeklyDigest";
import { tryAcquireCronLock, releaseCronLock } from "@/lib/cronLock";

const LOCK_NAME = "weekly-digest";

// Loops over live campaigns doing DB reads only (getCampaignDetail, no Apify/Claude calls),
// so this is fast even with more campaigns than exist today — 60s is generous headroom,
// not a measured requirement.
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Fail closed: an unset secret must never mean "no auth required" — same reasoning
    // every other cron route here uses.
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Weekly cadence makes a real overlap practically impossible, but the lock is cheap
  // insurance and matches every other cron route's convention rather than being a special case.
  if (!(await tryAcquireCronLock(LOCK_NAME, 300))) {
    return NextResponse.json({ skipped: true, reason: "previous invocation still running" });
  }

  try {
    const result = await sendWeeklyDigest();
    return NextResponse.json(result);
  } finally {
    await releaseCronLock(LOCK_NAME);
  }
}
