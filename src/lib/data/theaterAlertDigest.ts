/**
 * One demand summary per scan, instead of one email per flagged theater.
 *
 * raiseCampaignAlerts used to call notifier.send() inside its per-theater loop. With 32
 * flagged theaters that is 32 separate emails from a single scan, and at full Kerala
 * coverage (~178 theaters) it would be far worse — the same "trains the recipient to
 * ignore it" failure the dedup floor was written to prevent, arriving by a different
 * route. The dedup floor fixed how *often* a theater may be mentioned; it could not fix
 * how many messages one scan produces, because that was a fan-out, not a cadence.
 *
 * So the per-theater Alert rows stay exactly as they were — they are the dedup key and
 * the audit trail — and only delivery is batched into a single digest.
 *
 * Pure formatters, no DB or network calls, so they test against hand-built fixtures —
 * same split as weeklyDigest.ts's formatWeeklyDigest/formatWeeklyDigestHtml.
 */
import { TOKEN } from "@/lib/palette";
import { EMAIL_FONT, escapeHtml } from "./emailHtml";

/**
 * The disclaimer is load-bearing and must survive any reformatting: the recipient is
 * being asked to spend money on the strength of an availability label, and must not read
 * it as a sales figure. In the per-theater emails it was repeated on every message; in a
 * digest it belongs once, in the footer, where it still sits under every row.
 */
export const BMS_BASIS_NOTE =
  "Based on BookMyShow availability labels, not ticket sales. BookMyShow publishes no seat counts.";

// Deliberately a small summary type rather than the full TheaterRow — keeps the
// formatters' test surface to only what they actually render, same reasoning as
// weeklyDigest.ts's WeeklyDigestCampaignSummary.
export interface TheaterAlertSummary {
  theaterId: string;
  name: string;
  cityName: string;
  wideOpenShows: number;
  eligibleShows: number;
  confidence: string;
  reasons: string[];
}

export interface CampaignAlertDigest {
  movieName: string;
  theaters: TheaterAlertSummary[];
  generatedAt: Date;
}

/** Share of eligible shows still wide open, 0-100. The one number the digest ranks on. */
export function wideOpenPct(t: Pick<TheaterAlertSummary, "wideOpenShows" | "eligibleShows">): number {
  if (t.eligibleShows <= 0) return 0;
  return Math.round((t.wideOpenShows / t.eligibleShows) * 100);
}

// Worst first. A digest is read top-down and often only the top few rows get read at all,
// so the theater most in need of a push has to be the first thing on screen.
export function sortTheatersByUrgency(theaters: TheaterAlertSummary[]): TheaterAlertSummary[] {
  return [...theaters].sort(
    (a, b) => wideOpenPct(b) - wideOpenPct(a) || b.wideOpenShows - a.wideOpenShows || a.name.localeCompare(b.name),
  );
}

/** Cities in the digest, worst-theater-first, for the one-line "where" summary. */
export function citySummary(theaters: TheaterAlertSummary[]): string[] {
  return [...new Set(sortTheatersByUrgency(theaters).map((t) => t.cityName))];
}

export function digestSubject(d: CampaignAlertDigest): string {
  const n = d.theaters.length;
  return `${d.movieName}: ${n} theatre${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} a push`;
}

export function formatCampaignAlertDigest(d: CampaignAlertDigest): string {
  const ordered = sortTheatersByUrgency(d.theaters);
  const dateLabel = d.generatedAt.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const cities = citySummary(ordered);

  const lines = [
    `${d.movieName} — demand summary`,
    dateLabel,
    "",
    `${ordered.length} theatre${ordered.length === 1 ? "" : "s"} in the "push here" band across ${cities.length} ${cities.length === 1 ? "city" : "cities"}: ${cities.join(", ")}.`,
    "",
  ];

  for (const [i, t] of ordered.entries()) {
    lines.push(`${i + 1}. ${t.name}, ${t.cityName} — ${wideOpenPct(t)}% wide open`);
    lines.push(`   ${t.wideOpenShows} of ${t.eligibleShows} shows still wide open. Confidence: ${t.confidence}.`);
    if (t.reasons.length > 0) lines.push(`   ${t.reasons.join(" ")}`);
  }

  lines.push("", BMS_BASIS_NOTE);
  return lines.join("\n");
}

// Red at the top of the range, amber lower down — the same semantic pair used everywhere
// else in the app. Nothing here is ever green: every row in this digest is already a
// theater that cleared the "high" band, so a reassuring colour would misreport it.
function barColor(pct: number): string {
  return pct >= 60 ? TOKEN.pencilRed : TOKEN.pencilAmber;
}

/**
 * The visual half of the digest: one row per theater with a proportional bar, so the
 * reader can rank the list at a glance instead of parsing "14 of 18" on every line.
 *
 * Built from nested tables with inline styles, not flex/grid — Outlook renders neither,
 * and the bar is a table cell with a background colour and a percentage width for the
 * same reason (no CSS-drawn shapes, no images to be blocked).
 */
export function formatCampaignAlertDigestHtml(d: CampaignAlertDigest): string {
  const ordered = sortTheatersByUrgency(d.theaters);
  const dateLabel = d.generatedAt.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const cities = citySummary(ordered);

  const rows = ordered
    .map((t) => {
      const pct = wideOpenPct(t);
      const color = barColor(pct);
      // Never let a non-zero reading render as an empty bar — a 3% row still has to be
      // visible as a mark, or the reader sees "nothing" where there is a real signal.
      const barWidth = Math.max(pct, 2);
      const reasons = t.reasons.length > 0
        ? `<div style="font-size:11px;color:${TOKEN.inkFaint};padding-top:4px;">${escapeHtml(t.reasons.join(" "))}</div>`
        : "";

      return `<tr>
    <td style="padding:12px 0;border-bottom:1px solid ${TOKEN.rule};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-size:14px;font-weight:600;color:${TOKEN.ink};">${escapeHtml(t.name)}</td>
        <td style="font-size:16px;font-weight:700;text-align:right;color:${color};white-space:nowrap;">${pct}%</td>
      </tr></table>
      <div style="font-size:12px;color:${TOKEN.inkSoft};padding-top:2px;">${escapeHtml(t.cityName)} &middot; ${t.wideOpenShows} of ${t.eligibleShows} shows wide open &middot; ${escapeHtml(t.confidence)} confidence</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:7px;background:${TOKEN.paper};border-radius:3px;">
        <tr><td style="width:${barWidth}%;background:${color};height:8px;line-height:8px;font-size:0;border-radius:3px;">&nbsp;</td><td style="font-size:0;line-height:8px;">&nbsp;</td></tr>
      </table>
      ${reasons}
    </td>
  </tr>`;
    })
    .join("");

  return `<div style="font-family:${EMAIL_FONT};max-width:600px;margin:0 auto;color:${TOKEN.ink};">
  <div style="padding:0 0 16px;margin-bottom:4px;border-bottom:3px solid ${TOKEN.margin};">
    <div style="font-size:19px;font-weight:700;">${escapeHtml(d.movieName)} — demand summary</div>
    <div style="font-size:12px;color:${TOKEN.inkSoft};margin-top:2px;">${dateLabel}</div>
  </div>
  <div style="padding:14px 0 2px;font-size:13px;color:${TOKEN.inkSoft};">
    <strong style="color:${TOKEN.ink};font-size:15px;">${ordered.length} theatre${ordered.length === 1 ? "" : "s"}</strong> in the &ldquo;push here&rdquo; band across ${cities.length} ${cities.length === 1 ? "city" : "cities"}: ${escapeHtml(cities.join(", "))}.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
  <div style="padding-top:12px;margin-top:8px;font-size:11px;color:${TOKEN.inkFaint};">
    ${BMS_BASIS_NOTE}
  </div>
</div>`;
}
