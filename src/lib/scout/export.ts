// Builds a real .xlsx workbook for a Scoutline batch — distinct from the existing CSV export
// (CsvExportRegistrar/toCsv) in one deliberate way: the handle column carries a real
// clickable hyperlink to the Instagram profile, not just its URL as plain text. CSV has no
// hyperlink concept at all, so this needed its own path rather than reusing that one.
import * as XLSX from "xlsx";
import type { ScoutRawRow } from "@/lib/data/scout";

const HEADERS = [
  "Handle", "Name", "Deliverable", "Buzz Factor", "Followers", "Engagement %",
  "Comment Rate %", "Consistency", "Posts/Week", "Clips %", "Carousel %", "Image %",
  "Posts Analyzed", "Note", "Profile Link",
];

export function buildScoutExcelBuffer(rows: ScoutRawRow[]): Buffer {
  const body = rows.map((r) => [
    `@${r.handle}`,
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
    `https://www.instagram.com/${r.handle}/`,
  ]);

  const sheet = XLSX.utils.aoa_to_sheet([HEADERS, ...body]);

  // Real hyperlinks, not just a URL string — both the Handle column (col 0) and the
  // Profile Link column (col 14, kept as a plain-text fallback for anyone whose viewer
  // doesn't render the Handle column's link styling) point at the same profile.
  const handleCol = 0;
  const linkCol = HEADERS.length - 1;
  rows.forEach((r, i) => {
    const rowIdx = i + 1; // +1 for the header row
    const url = `https://www.instagram.com/${r.handle}/`;
    const handleRef = XLSX.utils.encode_cell({ r: rowIdx, c: handleCol });
    const linkRef = XLSX.utils.encode_cell({ r: rowIdx, c: linkCol });
    if (sheet[handleRef]) sheet[handleRef].l = { Target: url, Tooltip: `Open @${r.handle} on Instagram` };
    if (sheet[linkRef]) sheet[linkRef].l = { Target: url };
  });

  sheet["!cols"] = HEADERS.map((h) => ({ wch: Math.max(h.length + 2, 12) }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Buzz Factor Leaderboard");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
