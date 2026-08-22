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
//
// scoreTheater's `reasons` are deliberately NOT carried. Measured against the live
// campaign, they are near-identical on every flagged theater ("Weakness is across the
// slate... at or above the 80% wide-open threshold set for this campaign") and their first
// sentence restates the wide-open count the row already shows. Repeated down 82 rows they
// are noise that buries the ranking. They stay on the per-theater Alert row and on the
// campaign page, which is where a reader goes for the why.
export interface TheaterAlertSummary {
  theaterId: string;
  name: string;
  cityName: string;
  wideOpenShows: number;
  eligibleShows: number;
  confidence: string;
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

/**
 * How many theaters get a full detail row before the rest collapse into a compact list.
 *
 * Measured against the live "Bethlehem Kudumba Unit" campaign on 2026-08-22: 82 theaters
 * cleared the high band in a single scan, across 23 cities. Eighty-two detail rows is a
 * wall of near-identical text — the reader cannot find the theaters that matter, which is
 * the same "trains the recipient to ignore it" failure as the flood of separate emails,
 * just relocated inside one message.
 *
 * Nothing is dropped: everything past the cap still appears in the by-city list, and the
 * count is always stated. See DIGEST_TRUNCATION_NOTE.
 */
export const DIGEST_DETAIL_LIMIT = 15;

/** Flagged theaters per city, worst city first — the "where do I send someone" view. */
export function cityBreakdown(
  theaters: TheaterAlertSummary[],
): { cityName: string; count: number; wideOpenShows: number }[] {
  const byCity = new Map<string, { cityName: string; count: number; wideOpenShows: number }>();
  for (const t of theaters) {
    const entry = byCity.get(t.cityName) ?? { cityName: t.cityName, count: 0, wideOpenShows: 0 };
    entry.count++;
    entry.wideOpenShows += t.wideOpenShows;
    byCity.set(t.cityName, entry);
  }
  return [...byCity.values()].sort(
    (a, b) => b.count - a.count || b.wideOpenShows - a.wideOpenShows || a.cityName.localeCompare(b.cityName),
  );
}

/** Total wide-open shows across every flagged theater — the headline quantity. */
export function totalWideOpenShows(theaters: TheaterAlertSummary[]): number {
  return theaters.reduce((sum, t) => sum + t.wideOpenShows, 0);
}

export const DIGEST_TRUNCATION_NOTE = "Full reasoning for every theatre is on the campaign page.";

export function digestSubject(d: CampaignAlertDigest): string {
  const n = d.theaters.length;
  return `${d.movieName}: ${n} theatre${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} a push`;
}

export function formatCampaignAlertDigest(d: CampaignAlertDigest): string {
  const ordered = sortTheatersByUrgency(d.theaters);
  const dateLabel = d.generatedAt.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const cities = cityBreakdown(ordered);
  const detail = ordered.slice(0, DIGEST_DETAIL_LIMIT);
  const rest = ordered.slice(DIGEST_DETAIL_LIMIT);

  const lines = [
    `${d.movieName} — demand summary`,
    dateLabel,
    "",
    `${ordered.length} theatre${ordered.length === 1 ? "" : "s"} need a push — ${totalWideOpenShows(ordered)} shows still wide open across ${cities.length} ${cities.length === 1 ? "city" : "cities"}.`,
    "",
    "BY CITY",
  ];
  for (const c of cities) {
    lines.push(`  ${c.cityName} — ${c.count} theatre${c.count === 1 ? "" : "s"}, ${c.wideOpenShows} shows wide open`);
  }

  lines.push("", rest.length > 0 ? `WORST ${detail.length} THEATRES` : "THEATRES");
  for (const [i, t] of detail.entries()) {
    lines.push(`${i + 1}. ${t.name}, ${t.cityName} — ${wideOpenPct(t)}% wide open`);
    lines.push(`   ${t.wideOpenShows} of ${t.eligibleShows} shows still wide open. Confidence: ${t.confidence}.`);
  }

  // Never a silent cap — the remaining theaters are still named, just compactly.
  if (rest.length > 0) {
    lines.push("", `ALSO FLAGGED (${rest.length})`);
    for (const t of rest) {
      lines.push(`  ${wideOpenPct(t)}% — ${t.name}, ${t.cityName} (${t.wideOpenShows}/${t.eligibleShows})`);
    }
  }

  lines.push("", DIGEST_TRUNCATION_NOTE, BMS_BASIS_NOTE);
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
  const cities = cityBreakdown(ordered);
  const detail = ordered.slice(0, DIGEST_DETAIL_LIMIT);
  const rest = ordered.slice(DIGEST_DETAIL_LIMIT);
  const sectionHeading = `font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${TOKEN.inkFaint};padding:22px 0 8px;`;

  // Bars are scaled against the busiest city, not against 100 — with 23 cities the top
  // one may only hold 12 theaters, and scaling to 100 would flatten every bar to a stub
  // and make the chart unreadable.
  const maxCityCount = Math.max(...cities.map((c) => c.count), 1);
  const cityRows = cities
    .map(
      (c) => `<tr>
        <td style="font-size:12px;color:${TOKEN.ink};padding:3px 8px 3px 0;white-space:nowrap;">${escapeHtml(c.cityName)}</td>
        <td style="width:100%;padding:3px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="width:${Math.max(Math.round((c.count / maxCityCount) * 100), 3)}%;background:${TOKEN.pen};height:9px;line-height:9px;font-size:0;border-radius:2px;">&nbsp;</td>
            <td style="font-size:0;line-height:9px;">&nbsp;</td>
          </tr></table>
        </td>
        <td style="font-size:12px;font-weight:700;color:${TOKEN.ink};padding:3px 0 3px 8px;text-align:right;white-space:nowrap;">${c.count}</td>
      </tr>`,
    )
    .join("");

  const rows = detail
    .map((t) => {
      const pct = wideOpenPct(t);
      const color = barColor(pct);
      // Never let a non-zero reading render as an empty bar — a 3% row still has to be
      // visible as a mark, or the reader sees "nothing" where there is a real signal.
      const barWidth = Math.max(pct, 2);

      return `<tr>
    <td style="padding:12px 0;border-bottom:1px solid ${TOKEN.rule};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-size:14px;font-weight:600;color:${TOKEN.ink};">${escapeHtml(t.name)}</td>
        <td style="font-size:16px;font-weight:700;text-align:right;color:${color};white-space:nowrap;padding-left:8px;">${pct}%</td>
      </tr></table>
      <div style="font-size:12px;color:${TOKEN.inkSoft};padding-top:2px;">${escapeHtml(t.cityName)} &middot; ${t.wideOpenShows} of ${t.eligibleShows} shows wide open &middot; ${escapeHtml(t.confidence)} confidence</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:7px;background:${TOKEN.paper};border-radius:3px;">
        <tr><td style="width:${barWidth}%;background:${color};height:8px;line-height:8px;font-size:0;border-radius:3px;">&nbsp;</td><td style="font-size:0;line-height:8px;">&nbsp;</td></tr>
      </table>
    </td>
  </tr>`;
    })
    .join("");

  // Everything past the cap is still named — a silent truncation would read as "that is
  // the whole list" when it is not.
  const restBlock =
    rest.length === 0
      ? ""
      : `<div style="${sectionHeading}">Also flagged (${rest.length})</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rest
    .map(
      (t) => `<tr>
        <td style="font-size:12px;font-weight:700;color:${barColor(wideOpenPct(t))};padding:4px 10px 4px 0;white-space:nowrap;vertical-align:top;">${wideOpenPct(t)}%</td>
        <td style="font-size:12px;color:${TOKEN.inkSoft};padding:4px 0;">${escapeHtml(t.name)}<span style="color:${TOKEN.inkFaint};"> &middot; ${escapeHtml(t.cityName)} &middot; ${t.wideOpenShows}/${t.eligibleShows}</span></td>
      </tr>`,
    )
    .join("")}</table>`;

  return `<div style="font-family:${EMAIL_FONT};max-width:600px;margin:0 auto;color:${TOKEN.ink};">
  <div style="padding:0 0 16px;margin-bottom:4px;border-bottom:3px solid ${TOKEN.margin};">
    <div style="font-size:19px;font-weight:700;">${escapeHtml(d.movieName)} — demand summary</div>
    <div style="font-size:12px;color:${TOKEN.inkSoft};margin-top:2px;">${dateLabel}</div>
  </div>
  <div style="padding:14px 0 2px;font-size:13px;color:${TOKEN.inkSoft};">
    <strong style="color:${TOKEN.ink};font-size:15px;">${ordered.length} theatre${ordered.length === 1 ? "" : "s"}</strong> need a push &mdash; <strong style="color:${TOKEN.ink};">${totalWideOpenShows(ordered)} shows</strong> still wide open across ${cities.length} ${cities.length === 1 ? "city" : "cities"}.
  </div>
  <div style="${sectionHeading}">Where</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cityRows}</table>
  <div style="${sectionHeading}">${rest.length > 0 ? `Worst ${detail.length} theatres` : "Theatres"}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
  ${restBlock}
  <div style="padding-top:14px;margin-top:10px;border-top:1px solid ${TOKEN.rule};font-size:11px;color:${TOKEN.inkFaint};">
    ${DIGEST_TRUNCATION_NOTE}<br>${BMS_BASIS_NOTE}
  </div>
</div>`;
}
