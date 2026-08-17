// Scoutline ingestion: turns an uploaded PDF or Excel/CSV sheet of Instagram links into a
// flat, deduped candidate list. Both parsers converge on the same ParsedCandidate shape so
// nothing downstream cares which file format a batch came from.
//
// PDF field-name confirmed against a live extraction (2026-08-17) of the real
// "BKU X Snakeplant.pdf" influencer list via pdf-parse's PDFParse class (not the old
// callback-style v1 API this package name used to have — v2 exports a class). That file's
// layout is a narrow-column table exported to PDF (Google Sheets-style): each row is
// "N\tNAME" on its own line, then the instagram URL and igsh param wrapped across several
// tab-prefixed continuation lines (word-wrapped mid-string, never at a real word boundary),
// ending with the DELIVERABLES value (STORY/REEL). Concatenating a row's lines with no
// separator reconstructs the original unbroken text correctly for exactly that reason.

export interface ParsedCandidate {
  rowNumber: number | null;
  name: string | null;
  handle: string;
  profileUrl: string;
  deliverable: string | null;
}

export interface ParseResult {
  candidates: ParsedCandidate[];
  // Rows the file appeared to contain vs rows that yielded a usable Instagram handle —
  // reported so a bad parse (e.g. a scanned-image PDF with no text layer) fails loudly
  // instead of silently ingesting a handful of 200 rows. See client.ts's own "never let a
  // shortfall go unnoticed" precedent.
  rowsFound: number;
  rowsParsed: number;
}

/**
 * A user typing one or a few links/handles directly, one per line (commas also accepted) —
 * no name/deliverable column to read, so those come back null. Same dedup + shortfall
 * reporting as the file parsers so a stray non-Instagram line doesn't silently vanish.
 */
export function parseInfluencerManualText(text: string): ParseResult {
  const tokens = text
    .split(/[\n,]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const candidates: ParsedCandidate[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    // A bare word with no "instagram.com" and no plausible handle characters isn't a
    // link or a handle — profileUrlKey falls back to the raw token verbatim in that case,
    // so guard against garbage being treated as a real account.
    if (!/instagram\.com/i.test(token) && !/^[A-Za-z0-9_.]+$/.test(token)) continue;
    const key = profileUrlKey(token);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      rowNumber: null,
      name: null,
      handle: key,
      profileUrl: `https://www.instagram.com/${key}/`,
      deliverable: null,
    });
  }

  return { candidates, rowsFound: tokens.length, rowsParsed: candidates.length };
}

/** Normalized dedup key for an Instagram handle or URL — lowercased, no trailing punctuation. */
export function profileUrlKey(handleOrUrl: string): string {
  const m = handleOrUrl.match(/instagram\.com\/([A-Za-z0-9_.]+)/i);
  const handle = m ? m[1] : handleOrUrl;
  return handle.trim().toLowerCase().replace(/\.+$/, "");
}

function isRecordStartLine(line: string): boolean {
  const t = line.trim();
  if (t === "") return false;
  if (line.startsWith("\t")) return false;
  if (/^https/i.test(t)) return false;
  if (/^(influencer list|number\b)/i.test(t)) return false;
  return true;
}

/** Parses the raw text layer of an influencer-list-style PDF (see module doc). */
export function parseInfluencerListText(text: string): ParseResult {
  const lines = text.split(/\r?\n/);
  const records: { header: string; rest: string[] }[] = [];
  let current: { header: string; rest: string[] } | null = null;

  for (const line of lines) {
    if (isRecordStartLine(line)) {
      if (current) records.push(current);
      current = { header: line, rest: [] };
    } else if (current) {
      current.rest.push(line);
    }
  }
  if (current) records.push(current);

  const candidates: ParsedCandidate[] = [];
  const seen = new Set<string>();

  for (const { header, rest } of records) {
    const numMatch = header.match(/^(\d{1,4})\s*\t?\s*(.*)$/);
    const rowNumber = numMatch ? Number(numMatch[1]) : null;
    const name = (numMatch ? numMatch[2] : header).replace(/\t/g, " ").trim() || null;

    const block = rest.join("").replace(/\t/g, "");
    const handleMatch = block.match(/instagram\.com\/([A-Za-z0-9_.]+?)(?:\?|$)/i);
    if (!handleMatch) continue; // no usable link in this row — excluded from rowsParsed

    const key = profileUrlKey(handleMatch[1]);
    if (seen.has(key)) continue; // same account listed twice in one file — first row wins
    seen.add(key);

    const deliverableMatch = block.match(/(STORY|REEL)\s*$/i);

    candidates.push({
      rowNumber,
      name,
      handle: key,
      profileUrl: `https://www.instagram.com/${key}/`,
      deliverable: deliverableMatch ? deliverableMatch[1].toUpperCase() : null,
    });
  }

  return { candidates, rowsFound: records.length, rowsParsed: candidates.length };
}

export async function parseInfluencerPdf(buffer: Buffer): Promise<ParseResult> {
  // Dynamic import: this is a server-only, fairly heavy parser — no reason to let it
  // anywhere near a client bundle.
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  const { text } = await parser.getText();
  return parseInfluencerListText(text);
}

/**
 * Excel/CSV variant. Looks for a header row containing NAME/LINK-ish columns first (matches
 * the PDF's own column names); falls back to "whichever column has an instagram.com URL in
 * it" if no recognizable header exists, so a plain single-column list of links still works.
 */
export async function parseInfluencerExcel(buffer: Buffer): Promise<ParseResult> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  const isHeaderCell = (v: unknown, pattern: RegExp) => typeof v === "string" && pattern.test(v.trim());
  let headerRowIdx = -1;
  let nameCol = -1;
  let linkCol = -1;
  let numCol = -1;
  let deliverableCol = -1;

  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const row = rows[i];
    const li = row.findIndex((c) => isHeaderCell(c, /^link$|instagram/i));
    if (li === -1) continue;
    headerRowIdx = i;
    linkCol = li;
    nameCol = row.findIndex((c) => isHeaderCell(c, /^name$/i));
    numCol = row.findIndex((c) => isHeaderCell(c, /^number$|^#$|^no\.?$/i));
    deliverableCol = row.findIndex((c) => isHeaderCell(c, /deliverable/i));
    break;
  }

  const dataRows = headerRowIdx >= 0 ? rows.slice(headerRowIdx + 1) : rows;
  const candidates: ParsedCandidate[] = [];
  const seen = new Set<string>();
  let rowsFound = 0;

  for (const row of dataRows) {
    // No recognized header: scan every cell in the row for a link instead of a fixed column.
    const cells = row.map((c) => String(c ?? ""));
    const linkCell =
      linkCol >= 0 ? cells[linkCol] : cells.find((c) => /instagram\.com/i.test(c));
    if (!linkCell || !/instagram\.com/i.test(linkCell)) continue;
    rowsFound++;

    const key = profileUrlKey(linkCell);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    candidates.push({
      rowNumber: numCol >= 0 ? Number(cells[numCol]) || null : null,
      name: nameCol >= 0 ? cells[nameCol].trim() || null : null,
      handle: key,
      profileUrl: `https://www.instagram.com/${key}/`,
      deliverable: deliverableCol >= 0 ? cells[deliverableCol].trim().toUpperCase() || null : null,
    });
  }

  return { candidates, rowsFound, rowsParsed: candidates.length };
}
