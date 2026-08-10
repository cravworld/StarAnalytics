import { prisma } from "@/lib/prisma";
import { getCampaignDetail, type CampaignDetail } from "@/lib/data/campaigns";
import { getNotifierChannel, getNotifierProvider } from "@/lib/providers";

export const WEEKLY_DIGEST_ALERT_TYPE = "weekly_digest";

// Deliberately a small summary type, not the full ~20-field CampaignDetail — keeps
// formatWeeklyDigest's test surface to only what it actually reads, same reasoning
// negativeSentimentAlerts.ts's NegativeSpikeInput uses instead of a raw Prisma shape.
export interface WeeklyDigestCampaignSummary {
  name: string;
  buzzScore: number;
  postCount: number;
  engagementDisplay: string;
  sentiment: { positivePct: number; classifiedCount: number; totalCount: number } | null;
  topHashtag: { hashtag: string; postCount: number; totalEngagement: number } | null;
}

// Pure formatter — no DB/network calls — so it's testable against hand-built fixtures,
// same discipline as buzzScore.ts/scorePost.ts.
export function formatWeeklyDigest(campaigns: WeeklyDigestCampaignSummary[], generatedAt: Date): string {
  const dateLabel = generatedAt.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  if (campaigns.length === 0) {
    return `StarAnalytics Weekly Digest — ${dateLabel}\n\nNo live campaigns this week.`;
  }

  const lines = [`StarAnalytics Weekly Digest — ${dateLabel}`, ""];
  for (const c of campaigns) {
    lines.push(c.name);
    lines.push(`  Buzz score: ${c.buzzScore}`);
    lines.push(`  Posts tracked: ${c.postCount} (${c.engagementDisplay} engagement)`);
    lines.push(
      c.sentiment
        ? `  Sentiment: ${c.sentiment.positivePct}% positive (${c.sentiment.classifiedCount}/${c.sentiment.totalCount} classified)`
        : "  Sentiment: pending — no posts classified yet",
    );
    lines.push(
      c.topHashtag
        ? `  Top hashtag: #${c.topHashtag.hashtag} (${c.topHashtag.postCount} posts, ${c.topHashtag.totalEngagement.toLocaleString()} eng)`
        : "  Top hashtag: none tracked",
    );
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function toSummary(detail: CampaignDetail): WeeklyDigestCampaignSummary {
  return {
    name: detail.name,
    buzzScore: detail.buzzScore.score,
    postCount: detail.postCount,
    engagementDisplay: detail.hero.engagement,
    sentiment: detail.sentiment,
    topHashtag: detail.hashtagBreakdown[0] ?? null,
  };
}

// Orchestrator — fetches every live campaign's detail, formats one digest, writes an Alert
// row for audit first (type weekly_digest, no campaign/fanPage/post scoping since it spans
// every live campaign, all three FKs are nullable on Alert), and sends via the existing
// notifier. Same "row written first, deliveredAt only stamped once send() actually
// resolves" discipline as fanPageAlerts.ts/negativeSentimentAlerts.ts — a delivery failure
// must never look like a successful send.
export async function sendWeeklyDigest(): Promise<{ sent: boolean; campaignCount: number }> {
  const liveCampaigns = await prisma.campaign.findMany({ where: { status: "live" }, select: { id: true } });
  if (liveCampaigns.length === 0) {
    // Nothing to report — skip sending rather than emailing an empty digest every week.
    return { sent: false, campaignCount: 0 };
  }

  const details = (await Promise.all(liveCampaigns.map((c) => getCampaignDetail(c.id)))).filter(
    (d): d is CampaignDetail => d !== null,
  );
  const message = formatWeeklyDigest(details.map(toSummary), new Date());

  const alert = await prisma.alert.create({ data: { type: WEEKLY_DIGEST_ALERT_TYPE, message } });

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
    return { sent: true, campaignCount: details.length };
  } catch (err) {
    console.error("[weeklyDigest] delivery failed:", err);
    return { sent: false, campaignCount: details.length };
  }
}
