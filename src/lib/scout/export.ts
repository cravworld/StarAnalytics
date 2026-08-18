// Builds a real .xlsx workbook for a Scoutline batch — distinct from the existing CSV export
// (CsvExportRegistrar/toCsv) in one deliberate way: the handle column carries a real
// clickable hyperlink to the profile, not just its URL as plain text. CSV has no
// hyperlink concept at all, so this needed its own path rather than reusing that one.
import * as XLSX from "xlsx";
import type { ScoutRawRow } from "@/lib/data/scout";

const HEADERS = [
  "Handle", "Platform", "Name", "Deliverable", "Buzz Factor", "Followers", "Engagement %",
  "Comment Rate %", "Consistency", "Posts/Week", "Clips %", "Carousel %", "Image %",
  "Posts Analyzed", "Note", "Profile Link",
];

function profileUrl(r: Pick<ScoutRawRow, "platform" | "handle">): string {
  return r.platform === "facebook"
    ? `https://www.facebook.com/${r.handle}/`
    : `https://www.instagram.com/${r.handle}/`;
}

export function buildScoutExcelBuffer(rows: ScoutRawRow[]): Buffer {
  const body = rows.map((r) => [
    `@${r.handle}`,
    r.platform === "facebook" ? "Facebook" : "Instagram",
    r.suppliedName ?? "",
    r.deliverable ?? "",
    r.buzzFactor ?? "",
    r.followers ?? "",
    r.engagementRatePct ?? "",
    r.commentRatePct ?? "",
    r.consistencyScore ?? "",
    r.postingFrequencyPerWeek ?? "",
    r.contentMixClipsPct ?? "",
    r.contentMixCarouselPct ?? "",
    r.contentMixImagePct ?? "",
    r.postsAnalyzed ?? "",
    r.note ?? "",
    profileUrl(r),
  ]);

  const sheet = XLSX.utils.aoa_to_sheet([HEADERS, ...body]);

  // Real hyperlinks, not just a URL string — both the Handle column (col 0) and the
  // Profile Link column (last column, kept as a plain-text fallback for anyone whose viewer
  // doesn't render the Handle column's link styling) point at the same profile, on whichever
  // platform that candidate actually belongs to.
  const handleCol = 0;
  const linkCol = HEADERS.length - 1;
  rows.forEach((r, i) => {
    const rowIdx = i + 1; // +1 for the header row
    const url = profileUrl(r);
    const platformLabel = r.platform === "facebook" ? "Facebook" : "Instagram";
    const handleRef = XLSX.utils.encode_cell({ r: rowIdx, c: handleCol });
    const linkRef = XLSX.utils.encode_cell({ r: rowIdx, c: linkCol });
    if (sheet[handleRef]) sheet[handleRef].l = { Target: url, Tooltip: `Open @${r.handle} on ${platformLabel}` };
    if (sheet[linkRef]) sheet[linkRef].l = { Target: url };
  });

  sheet["!cols"] = HEADERS.map((h) => ({ wch: Math.max(h.length + 2, 12) }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Buzz Factor Leaderboard");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
