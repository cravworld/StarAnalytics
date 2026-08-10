import { prisma } from "@/lib/prisma";
import { getCampaignDetail, type CampaignDetail } from "@/lib/data/campaigns";
import { getNotifierChannel, getNotifierProvider } from "@/lib/providers";

export const WEEKLY_DIGEST_ALERT_TYPE = "weekly_digest";

// Same colors as SentimentBar.tsx's LABEL_META, copied rather than imported — that file is
// a "use client" component, not meant to be pulled into server-only data code, and it's
// three hex values; if they ever drift apart, that's a signal to extract a shared token
// file, not evidence this copy was a mistake.
const SENTIMENT_COLOR = { pos: "#1a7a4a", neu: "#bdbdbd", neg: "#c62828" } as const;

// Deliberately a small summary type, not the full ~20-field CampaignDetail — keeps the
// formatters' test surface to only what they actually read, same reasoning
// negativeSentimentAlerts.ts's NegativeSpikeInput uses instead of a raw Prisma shape.
export interface WeeklyDigestCampaignSummary {
  name: string;
  buzzScore: number;
  // Null until a real snapshot >=5 days old exists — see campaignBuzzSnapshots.ts's
  // getBuzzWeekAgoDelta. The first digest after this feature ships has genuinely no
  // history to compare against; that must render as "no comparison yet," not a fabricated
  // delta.
  buzzWeekAgoDelta: number | null;
  postCount: number;
  engagementDisplay: string;
  sentiment: { positivePct: number; neutralPct: number; negativePct: number; classifiedCount: number; totalCount: number } | null;
  topHashtag: { hashtag: string; postCount: number; totalEngagement: number } | null;
}

// Highest buzz first — the point of a digest is catching what needs attention without
// reading every line, so the most notable campaign should be the first thing either
// formatter renders, not whatever order the DB happened to return.
export function sortCampaignsByBuzz(campaigns: WeeklyDigestCampaignSummary[]): WeeklyDigestCampaignSummary[] {
  return [...campaigns].sort((a, b) => b.buzzScore - a.buzzScore);
}

// Pure formatter — no DB/network calls — so it's testable against hand-built fixtures,
// same discipline as buzzScore.ts/scorePost.ts. Renders campaigns in the order given (the
// caller decides ordering — see sortCampaignsByBuzz — this stays a dumb renderer).
export function formatWeeklyDigest(campaigns: WeeklyDigestCampaignSummary[], generatedAt: Date): string {
  const dateLabel = generatedAt.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  if (campaigns.length === 0) {
    return `StarAnalytics Weekly Digest — ${dateLabel}\n\nNo live campaigns this week.`;
  }

  const lines = [
    `StarAnalytics Weekly Digest — ${dateLabel}`,
    `${campaigns.length} live campaign${campaigns.length === 1 ? "" : "s"} this week`,
    "",
  ];
  for (const c of campaigns) {
    lines.push(c.name);
    lines.push(
      `  Buzz score: ${c.buzzScore}${c.buzzWeekAgoDelta === null ? "" : ` (${c.buzzWeekAgoDelta >= 0 ? "+" : ""}${c.buzzWeekAgoDelta} vs last week)`}`,
    );
    lines.push(`  Posts tracked: ${c.postCount} (${c.engagementDisplay} engagement)`);
    lines.push(
      c.sentiment
        ? `  Sentiment: ${c.sentiment.positivePct}% positive / ${c.sentiment.neutralPct}% neutral / ${c.sentiment.negativePct}% negative (${c.sentiment.classifiedCount}/${c.sentiment.totalCount} classified)`
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

// A thin colored proportional bar, table-cell-width based (not CSS width) so it survives
// Outlook's stripped-down renderer. `width` percentages are rounded and can undershoot
// 100 by a point or two when the source percentages themselves don't sum exactly — same
// harmless rounding gap the in-app SentimentBar already has, not a new problem.
function sentimentBarHtml(s: { positivePct: number; neutralPct: number; negativePct: number }): string {
  const seg = (pct: number, color: string) =>
    pct > 0 ? `<td width="${pct}%" style="background:${color};font-size:1px;line-height:7px;">&nbsp;</td>` : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="height:7px;margin-top:4px;">
    <tr>${seg(s.positivePct, SENTIMENT_COLOR.pos)}${seg(s.neutralPct, SENTIMENT_COLOR.neu)}${seg(s.negativePct, SENTIMENT_COLOR.neg)}</tr>
  </table>`;
}

// HTML sibling of formatWeeklyDigest — same data, same pure/no-IO discipline (including
// "render in the order given," see sortCampaignsByBuzz), rendered as an email. Table-based
// layout with every style inlined (no <style> block, no flexbox/grid) because Outlook's
// desktop rendering engine (Word) ignores both — this is deliberately the most compatible
// subset of HTML/CSS for email, not a stylistic choice. Uses this app's own brand tokens
// (accent pink, buzz-score bands, sentiment colors, muted/border greys from globals.css)
// so the email reads as the same product as the dashboard, not a generic report.
export function formatWeeklyDigestHtml(campaigns: WeeklyDigestCampaignSummary[], generatedAt: Date): string {
  const dateLabel = generatedAt.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif";

  const body =
    campaigns.length === 0
      ? `<p style="font-size:14px;color:#6b6b84;margin:0;">No live campaigns this week.</p>`
      : campaigns
          .map((c, i) => {
            const buzzColor = buzzBandColor(c.buzzScore);
            // Only the single highest-buzz campaign can wear this, and only when its score
            // is genuinely in the green band — an honest "this is actually good," not just
            // "happened to sort first" (a lone campaign at buzz 20 isn't a top performer).
            const isTopPerformer = i === 0 && c.buzzScore >= 70;
            const sentimentBlock = c.sentiment
              ? `<tr><td colspan="2" style="padding:5px 0 0;">
                   <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                     <td style="font-size:13px;color:#6b6b84;">Sentiment</td>
                     <td style="font-size:13px;text-align:right;font-weight:600;color:${SENTIMENT_COLOR.pos};">${c.sentiment.positivePct}% positive <span style="color:#9a9ab2;font-weight:400;">(${c.sentiment.classifiedCount}/${c.sentiment.totalCount})</span></td>
                   </tr></table>
                   ${sentimentBarHtml(c.sentiment)}
                 </td></tr>`
              : `<tr><td style="padding:5px 0;font-size:13px;color:#6b6b84;">Sentiment</td><td style="padding:5px 0;font-size:13px;text-align:right;color:#9a9ab2;">pending</td></tr>`;
            const hashtagRow = c.topHashtag
              ? `<tr><td style="padding:8px 0 0;font-size:13px;color:#6b6b84;">Top hashtag</td><td style="padding:8px 0 0;font-size:13px;text-align:right;font-weight:600;">#${escapeHtml(c.topHashtag.hashtag)} <span style="color:#9a9ab2;font-weight:400;">(${c.topHashtag.postCount} posts)</span></td></tr>`
              : `<tr><td style="padding:8px 0 0;font-size:13px;color:#6b6b84;">Top hashtag</td><td style="padding:8px 0 0;font-size:13px;text-align:right;color:#9a9ab2;">none tracked</td></tr>`;

            return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e7e7ef;border-left:4px solid ${buzzColor};border-radius:10px;margin-bottom:16px;overflow:hidden;">
  <tr>
    <td style="padding:14px 16px;background:#fafafa;border-bottom:1px solid #e7e7ef;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-size:15px;font-weight:700;color:#0f0f14;">
          ${escapeHtml(c.name)}${isTopPerformer ? ` <span style="font-size:11px;font-weight:700;color:${buzzColor};">🔥 TOP PERFORMER</span>` : ""}
        </td>
        <td style="text-align:right;white-space:nowrap;">
          <span style="display:inline-block;background:${buzzColor};color:#ffffff;padding:4px 12px;border-radius:14px;font-size:13px;font-weight:800;">${c.buzzScore}</span>
          ${
            c.buzzWeekAgoDelta === null
              ? ""
              : `<div style="font-size:10px;font-weight:700;margin-top:3px;color:${c.buzzWeekAgoDelta >= 0 ? SENTIMENT_COLOR.pos : SENTIMENT_COLOR.neg};">${c.buzzWeekAgoDelta >= 0 ? "+" : ""}${c.buzzWeekAgoDelta} vs last week</div>`
          }
        </td>
      </tr></table>
    </td>
  </tr>
  <tr>
    <td style="padding:12px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:5px 0;font-size:13px;color:#6b6b84;">Posts tracked</td><td style="padding:5px 0;font-size:13px;text-align:right;font-weight:600;">${c.postCount}</td></tr>
        <tr><td style="padding:5px 0;font-size:13px;color:#6b6b84;">Engagement</td><td style="padding:5px 0;font-size:13px;text-align:right;font-weight:600;">${escapeHtml(c.engagementDisplay)}</td></tr>
        ${sentimentBlock}
        ${hashtagRow}
      </table>
    </td>
  </tr>
</table>`;
          })
          .join("");

  const summaryLine =
    campaigns.length > 0
      ? `<div style="font-size:13px;color:#6b6b84;margin-top:6px;">${campaigns.length} live campaign${campaigns.length === 1 ? "" : "s"} this week</div>`
      : "";

  return `<div style="font-family:${FONT};max-width:600px;margin:0 auto;color:#0f0f14;">
  <div style="padding:0 0 16px;margin-bottom:16px;border-bottom:3px solid #E1306C;">
    <div style="font-size:19px;font-weight:800;color:#E1306C;">StarAnalytics Weekly Digest</div>
    <div style="font-size:12px;color:#6b6b84;margin-top:2px;">${dateLabel}</div>
    ${summaryLine}
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
    buzzWeekAgoDelta: detail.buzzWeekAgoDelta,
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
  const summaries = sortCampaignsByBuzz(details.map(toSummary));
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
