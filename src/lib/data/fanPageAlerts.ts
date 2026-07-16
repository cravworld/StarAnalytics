import { prisma } from "@/lib/prisma";
import { getNotifierChannel, getNotifierProvider } from "@/lib/providers";

// Named constants, not a DB-versioned config — matches getTrackedHashtags's convention
// (src/lib/data/campaigns.ts) rather than the scoring engine's ThresholdConfig, which is
// shaped specifically around scorePost's weights and not a good fit for a single on/off
// velocity check. Revisit as versioned config only if this needs to change per-campaign.
const VELOCITY_WINDOW_MINUTES = 60;
const VELOCITY_LIKES_THRESHOLD = 500;

// Checks whether any of the given posts are a tracked fan page posting a tracked
// campaign's hashtag, at/above the like threshold, within the window since posting.
// This is a scrape-time snapshot (we know "had N likes when we happened to scrape,
// M minutes after posting"), not a true measured accrual rate — the message below is
// worded to reflect exactly that, not an implied "N likes in M minutes" velocity.
export async function checkFanPageVelocityAlerts(postIds: string[]): Promise<void> {
  if (postIds.length === 0) return;

  const posts = await prisma.post.findMany({
    where: {
      id: { in: postIds },
      fanPageId: { not: null },
      campaignId: { not: null },
      likes: { gte: VELOCITY_LIKES_THRESHOLD },
    },
    include: { fanPage: true, campaign: true },
  });
  if (posts.length === 0) return;

  const now = Date.now();
  const qualifying = posts.filter((p) => {
    if (!p.postedAt) return false;
    const minutesSincePosted = (now - p.postedAt.getTime()) / (60 * 1000);
    return minutesSincePosted <= VELOCITY_WINDOW_MINUTES;
  });
  if (qualifying.length === 0) return;

  const existing = await prisma.alert.findMany({
    where: { postId: { in: qualifying.map((p) => p.id) } },
    select: { postId: true },
  });
  const alerted = new Set(existing.map((a) => a.postId));
  const toAlert = qualifying.filter((p) => !alerted.has(p.id));
  if (toAlert.length === 0) return;

  const notifier = getNotifierProvider();
  for (const post of toAlert) {
    const minutesSincePosted = Math.round((now - post.postedAt!.getTime()) / (60 * 1000));
    const handle = post.fanPage?.igHandle ?? post.authorHandle ?? "unknown account";
    const hashtag = post.campaign?.hashtags?.find((h) => (post.caption ?? "").toLowerCase().includes(`#${h}`));
    const tagLabel = hashtag ? `#${hashtag}` : post.campaign?.name ?? "a tracked campaign";
    const message = `${handle} posted ${tagLabel} ${minutesSincePosted} min ago — already at ${post.likes} likes.`;

    const alert = await prisma.alert.create({
      data: {
        type: "fan_page_hashtag_velocity",
        fanPageId: post.fanPageId,
        campaignId: post.campaignId,
        postId: post.id,
        message,
      },
    });

    // A delivery failure (provider down, bad credentials) must never look like a
    // successful send — deliveredAt/channel only get set once send() actually resolves.
    // The Alert row itself is never lost either way; it just stays "not yet delivered".
    try {
      await notifier.send({
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
      console.error(`[fanPageAlerts] delivery failed for alert ${alert.id}:`, err);
    }
  }
}
