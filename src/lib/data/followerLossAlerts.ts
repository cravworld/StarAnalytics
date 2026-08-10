// Follower-decline alerting — the growth-only blind spot in accountSnapshots.ts (that file's
// getFollowerTrends only ever surfaces deltaPct for display, nothing acts on a real drop).
// Genuinely different signal from comment-sentiment-based alerting: this fires on account-
// level follower count, not on anything about a post's comments.
import { prisma } from "@/lib/prisma";
import { getNotifierChannel, getNotifierProvider } from "@/lib/providers";
import type { PlatformId } from "@/lib/providers/types";

export const FOLLOWER_LOSS_ALERT_TYPE = "follower_loss";

export interface FollowerLossParams {
  /** Minimum consecutive-snapshot drop, as a percentage, before this is worth a message. */
  dropPctThreshold: number;
  /**
   * Below this follower count, normal day-to-day unfollow/follow noise can swing a
   * percentage wildly (losing 1 of 5 followers is 20%) — too small a base for a percentage
   * threshold to mean anything.
   */
  minFollowersForCheck: number;
}

// Not independently tuned against real decline data — AccountSnapshot has zero rows in
// production today (zero competitors/fan pages currently tracked), so there is no real
// follower-loss history to calibrate against yet. Picked as reasonable defaults (a 3%
// single-step drop is a real move, not typical noise) and left as named params specifically
// so they're easy to revisit once real data exists to tune against.
export const DEFAULT_FOLLOWER_LOSS_PARAMS: FollowerLossParams = {
  dropPctThreshold: 3,
  minFollowersForCheck: 100,
};

export interface FollowerLossVerdict {
  shouldAlert: boolean;
  dropPct: number;
  dropAbsolute: number;
}

// Pure — no DB/network calls — testable against hand-built snapshot pairs, same discipline
// as buzzScore.ts/scorePost.ts. Compares only two consecutive snapshots (not a rolling
// peak) — once a count stabilizes at a lower level, the next consecutive delta returns to
// ~0 on its own, so this self-limits without needing an explicit already-alerted dedup
// check the way checkFanPageVelocityAlerts needs one for its per-post state.
export function evaluateFollowerLoss(
  previousFollowers: number,
  currentFollowers: number,
  params: FollowerLossParams = DEFAULT_FOLLOWER_LOSS_PARAMS,
): FollowerLossVerdict {
  const dropAbsolute = previousFollowers - currentFollowers;
  if (previousFollowers < params.minFollowersForCheck || dropAbsolute <= 0) {
    return { shouldAlert: false, dropPct: 0, dropAbsolute: Math.max(0, dropAbsolute) };
  }
  const dropPct = (dropAbsolute / previousFollowers) * 100;
  return { shouldAlert: dropPct >= params.dropPctThreshold, dropPct, dropAbsolute };
}

// Called from recordAccountSnapshot() right after it writes a new row — same "check at the
// moment new data arrives" discipline as checkFanPageVelocityAlerts, not a separate polling
// cron. A no-op until a second snapshot for this handle exists (nothing to compare yet).
export async function checkFollowerLossAlert(platform: PlatformId, igHandle: string): Promise<void> {
  const recent = await prisma.accountSnapshot.findMany({
    where: { platform, igHandle },
    orderBy: { capturedAt: "desc" },
    take: 2,
  });
  if (recent.length < 2) return;

  const [current, previous] = recent;
  const verdict = evaluateFollowerLoss(previous.followers, current.followers);
  if (!verdict.shouldAlert) return;

  // No Alert FK fits here — fanPageId only covers fan pages, competitors have no slot at
  // all, and this same check runs for both. Same choice the weekly digest already made:
  // everything meaningful goes in the message text, all three FKs stay null.
  const message = `@${igHandle} (${platform}) lost ${verdict.dropAbsolute.toLocaleString()} followers (${verdict.dropPct.toFixed(1)}%) — ${previous.followers.toLocaleString()} → ${current.followers.toLocaleString()}.`;

  const alert = await prisma.alert.create({ data: { type: FOLLOWER_LOSS_ALERT_TYPE, message } });

  // Same "row written first, deliveredAt only stamped once send() actually resolves"
  // discipline as every other alert path in this app — a delivery failure must never look
  // like a successful send.
  try {
    await getNotifierProvider().send({
      id: alert.id,
      type: alert.type,
      message: alert.message,
      createdAt: alert.createdAt.toISOString(),
    });
    await prisma.alert.update({
      where: { id: alert.id },
      data: { deliveredAt: new Date(), channel: getNotifierChannel() },
    });
  } catch (err) {
    console.error(`[followerLossAlerts] delivery failed for alert ${alert.id}:`, err);
  }
}
