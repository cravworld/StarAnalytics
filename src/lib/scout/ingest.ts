// Scoutline ingestion: turns an uploaded PDF or Excel/CSV sheet of Instagram links into a
// flat, deduped candidate list. Both parsers converge on the same ParsedCandidate shape so
// nothing downstream cares which file format a batch came from.
//
// PDF layout confirmed against a live extraction (2026-08-17) of the real "BKU X
// Snakeplant.pdf" influencer list: a narrow-column table exported to PDF (Google
// Sheets-style), where each row is "N NAME" on its own line, then the instagram URL and
// igsh param wrapped across several continuation lines (word-wrapped mid-string, never at a
// real word boundary — concatenating with no separator reconstructs the original unbroken
// text), ending with the DELIVERABLES value (STORY/REEL).
//
// Originally built against pdf-parse's PDFParse class (tab-prefixed continuation lines,
// distinguishable from a header line by that leading tab), then switched to `unpdf`
// (2026-08-17, same day — pdf-parse pulls in @napi-rs/canvas, a native binary dependency
// that works fine locally but throws on Vercel's serverless Linux runtime; confirmed live in
// production as the actual cause of every /api/scout/upload request 500ing). unpdf's text
// has no tab prefixes at all, so the parser below is anchored on the URL block itself
// (a line starting "https" through the line ending STORY/REEL) rather than on indentation —
// robust to either extractor's exact whitespace, not just the one currently in use.

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

function isTitleOrHeaderLine(line: string): boolean {
  return /^(influencer list|number\b)/i.test(line);
}

/**
 * Parses the raw text layer of an influencer-list-style PDF (see module doc). Anchored on
 * the URL block itself — a line starting "https" through whichever later line ends in
 * STORY/REEL is one record's worth of link data — rather than on indentation, since that
 * varies between text extractors and isn't a signal worth depending on.
 */
export function parseInfluencerListText(text: string): ParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !isTitleOrHeaderLine(l));

  const candidates: ParsedCandidate[] = [];
  const seen = new Set<string>();
  let headerBuf: string[] = [];
  let urlBuf: string[] = [];
  let inUrl = false;
  let rowsFound = 0;

  const finalizeRecord = () => {
    const block = urlBuf.join("").replace(/\s+/g, "");
    const headerLine = headerBuf.join(" ").trim();
    headerBuf = [];
    urlBuf = [];
    inUrl = false;

    const handleMatch = block.match(/instagram\.com\/([A-Za-z0-9_.]+?)(?:\?|$)/i);
    if (!handleMatch) return; // no usable link in this row — excluded from rowsParsed

    const key = profileUrlKey(handleMatch[1]);
    if (seen.has(key)) return; // same account listed twice in one file — first row wins
    seen.add(key);

    const numMatch = headerLine.match(/^(\d{1,4})\s+(.*)$/);
    const deliverableMatch = block.match(/(STORY|REEL)$/i);

    candidates.push({
      rowNumber: numMatch ? Number(numMatch[1]) : null,
      name: (numMatch ? numMatch[2] : headerLine).trim() || null,
      handle: key,
      profileUrl: `https://www.instagram.com/${key}/`,
      deliverable: deliverableMatch ? deliverableMatch[1].toUpperCase() : null,
    });
  };

  for (const line of lines) {
    if (/^https/i.test(line)) {
      // A new URL block starting while the last one is still open means that row had no
      // (or an unrecognized) DELIVERABLES value — finalize what's collected so far rather
      // than let it silently swallow every row after it. Missing/blank deliverables are a
      // real case (that column is soft context for scoring, not something a source file is
      // guaranteed to fill in), so the parser can't require it to segment rows correctly.
      if (inUrl) finalizeRecord();
      inUrl = true;
      urlBuf = [line];
      rowsFound++;
      continue;
    }
    if (inUrl) {
      if (/(STORY|REEL)\s*$/i.test(line)) {
        urlBuf.push(line);
        finalizeRecord();
        continue;
      }
      // Same missing-deliverable case as above, but for the next row's NAME line rather
      // than its URL — a URL/base64 continuation fragment is always a single unbroken
      // token in this format (confirmed against the real extraction), so a line containing
      // a space is name text, not part of the link. (A genuinely single-word name on a row
      // with a missing deliverable is the one case this still can't distinguish from a
      // fragment — rare enough, and loses only that one row's name, never its handle.)
      if (/\s/.test(line)) {
        finalizeRecord();
        headerBuf.push(line);
        continue;
      }
      urlBuf.push(line);
      continue;
    }
    headerBuf.push(line); // name/number text for whichever record's URL starts next
  }
  if (inUrl) finalizeRecord(); // last row, whether or not it had a deliverable token

  return { candidates, rowsFound, rowsParsed: candidates.length };
}

export async function parseInfluencerPdf(buffer: Buffer): Promise<ParseResult> {
  // Dynamic import: this is a server-only parser — no reason to let it anywhere near a
  // client bundle. `unpdf`, not `pdf-parse`: pdf-parse pulls in @napi-rs/canvas, a native
  // binary dependency that works locally but throws on Vercel's serverless Linux runtime
  // (confirmed live — every /api/scout/upload request 500'd in production because of it).
  // unpdf is pure JS, built specifically for serverless/edge PDF text extraction.
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
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
