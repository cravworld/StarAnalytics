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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Same green/yellow/red bands as the campaign detail page's BuzzScoreBadge (bandColor in
// campaigns/[id]/page.tsx) — kept as a small standalone copy rather than an import since
// that file is a page component (not meant to be imported from server-only data code) and
// this is three lines; if the bands ever drift apart, that's a signal to extract a shared
// helper, not evidence this copy was a mistake.
function buzzBandColor(score: number): string {
  if (score >= 70) return "#1a7a4a";
  if (score >= 40) return "#e6a700";
  return "#c62828";
}

// HTML sibling of formatWeeklyDigest — same data, same pure/no-IO discipline, rendered as
// an email. Table-based layout with every style inlined (no <style> block, no flexbox/grid)
// because Outlook's desktop rendering engine (Word) ignores both — this is deliberately the
// most compatible subset of HTML/CSS for email, not a stylistic choice. Uses this app's own
// brand tokens (accent pink, buzz-score bands, muted/border greys from globals.css) so the
// email reads as the same product as the dashboard, not a generic report.
export function formatWeeklyDigestHtml(campaigns: WeeklyDigestCampaignSummary[], generatedAt: Date): string {
  const dateLabel = generatedAt.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif";

  const body =
    campaigns.length === 0
      ? `<p style="font-size:14px;color:#6b6b84;margin:0;">No live campaigns this week.</p>`
      : campaigns
          .map((c) => {
            const buzzColor = buzzBandColor(c.buzzScore);
            const sentimentRow = c.sentiment
              ? `<tr><td style="padding:5px 0;font-size:13px;color:#6b6b84;">Sentiment</td><td style="padding:5px 0;font-size:13px;text-align:right;font-weight:600;color:#1a7a4a;">${c.sentiment.positivePct}% positive <span style="color:#9a9ab2;font-weight:400;">(${c.sentiment.classifiedCount}/${c.sentiment.totalCount})</span></td></tr>`
              : `<tr><td style="padding:5px 0;font-size:13px;color:#6b6b84;">Sentiment</td><td style="padding:5px 0;font-size:13px;text-align:right;color:#9a9ab2;">pending</td></tr>`;
            const hashtagRow = c.topHashtag
              ? `<tr><td style="padding:5px 0;font-size:13px;color:#6b6b84;">Top hashtag</td><td style="padding:5px 0;font-size:13px;text-align:right;font-weight:600;">#${escapeHtml(c.topHashtag.hashtag)} <span style="color:#9a9ab2;font-weight:400;">(${c.topHashtag.postCount} posts)</span></td></tr>`
              : `<tr><td style="padding:5px 0;font-size:13px;color:#6b6b84;">Top hashtag</td><td style="padding:5px 0;font-size:13px;text-align:right;color:#9a9ab2;">none tracked</td></tr>`;

            return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e7e7ef;border-radius:10px;margin-bottom:16px;overflow:hidden;">
  <tr>
    <td style="padding:14px 16px;background:#fafafa;border-bottom:1px solid #e7e7ef;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-size:15px;font-weight:700;color:#0f0f14;">${escapeHtml(c.name)}</td>
        <td style="text-align:right;">
          <span style="display:inline-block;background:${buzzColor};color:#ffffff;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;">${c.buzzScore} BUZZ</span>
        </td>
      </tr></table>
    </td>
  </tr>
  <tr>
    <td style="padding:12px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:5px 0;font-size:13px;color:#6b6b84;">Posts tracked</td><td style="padding:5px 0;font-size:13px;text-align:right;font-weight:600;">${c.postCount}</td></tr>
        <tr><td style="padding:5px 0;font-size:13px;color:#6b6b84;">Engagement</td><td style="padding:5px 0;font-size:13px;text-align:right;font-weight:600;">${escapeHtml(c.engagementDisplay)}</td></tr>
        ${sentimentRow}
        ${hashtagRow}
      </table>
    </td>
  </tr>
</table>`;
          })
          .join("");

  return `<div style="font-family:${FONT};max-width:600px;margin:0 auto;color:#0f0f14;">
  <div style="padding:0 0 16px;margin-bottom:16px;border-bottom:3px solid #E1306C;">
    <div style="font-size:19px;font-weight:800;color:#E1306C;">StarAnalytics Weekly Digest</div>
    <div style="font-size:12px;color:#6b6b84;margin-top:2px;">${dateLabel}</div>
  </div>
  ${body}
  <div style="padding-top:12px;margin-top:8px;border-top:1px solid #e7e7ef;font-size:11px;color:#9a9ab2;">
    Generated automatically by StarAnalytics.
  </div>
</div>`;
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
  const summaries = details.map(toSummary);
  const now = new Date();
  const message = formatWeeklyDigest(summaries, now);
  const html = formatWeeklyDigestHtml(summaries, now);

  // The stored Alert.message stays plain text (that column has no html sibling, and every
  // other alert type only ever has plain text) — html is passed straight to the notifier,
  // not persisted, same as it's never read back anywhere.
  const alert = await prisma.alert.create({ data: { type: WEEKLY_DIGEST_ALERT_TYPE, message } });

  try {
    await getNotifierProvider().send({
      id: alert.id,
      type: alert.type,
      message: alert.message,
      createdAt: alert.createdAt.toISOString(),
      html,
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
