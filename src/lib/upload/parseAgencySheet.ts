// Client-side parsing for the agency upload screen — Excel/CSV drop or a
// pasted URL list, both in the "Agency Name, Post URL" two-column shape (per
// the team's confirmed sheet format). Runs in the browser so link counts show
// up immediately, before "Analyse All Posts" ever calls the server.
import * as XLSX from "xlsx";

export interface AgencyUrlRow {
  agencyName: string;
  url: string;
}

export interface ParseResult {
  rows: AgencyUrlRow[];
  invalidCount: number;
}

// Plausible IG post/reel URL — rows that don't match are dropped and counted,
// never silently queued as if they were valid. Exported so the server-side action
// can re-validate: this file runs in the browser, so its checks are a UX nicety,
// not a security boundary — the server must never trust them.
export const IG_POST_URL_RE = /instagram\.com\/(p|reel|reels)\/[A-Za-z0-9_-]+/i;

function toRows(records: unknown[][]): ParseResult {
  const rows: AgencyUrlRow[] = [];
  let invalidCount = 0;
  for (const record of records) {
    const agencyName = String(record[0] ?? "").trim();
    const url = String(record[1] ?? "").trim();
    if (!agencyName && !url) continue; // blank row
    if (!agencyName || !url || !IG_POST_URL_RE.test(url)) {
      invalidCount++;
      continue;
    }
    rows.push({ agencyName, url });
  }
  return { rows, invalidCount };
}

// Sheets/pastes commonly start with a header row ("Agency Name, Post URL").
// Detected rather than unconditionally skipped, so a headerless paste doesn't
// silently lose its first real row.
function dropHeaderIfPresent(records: unknown[][]): unknown[][] {
  if (records.length === 0) return records;
  const firstUrl = String(records[0][1] ?? "");
  const looksLikeHeader = firstUrl.length > 0 && !IG_POST_URL_RE.test(firstUrl);
  return looksLikeHeader ? records.slice(1) : records;
}

export async function parseAgencyFile(file: File): Promise<ParseResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const records = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  return toRows(dropHeaderIfPresent(records));
}

export function parsePastedText(text: string): ParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const records = lines.map((line) => line.split(",").map((c) => c.trim()));
  return toRows(dropHeaderIfPresent(records));
}
