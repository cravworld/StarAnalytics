// Upload endpoint for a Scoutline batch — a route handler, not a Server Action, since
// Server Actions cap request bodies at 1MB by default (see server-actions.md) and an
// uploaded PDF/Excel sheet can exceed that. Parses the file, persists the batch +
// candidates, kicks off the Apify run(s), and returns immediately — ingestion happens on
// the poll-scout-runs cron, never inline on this request (see scout.ts's module doc).
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createScoutBatch, startScoutRuns } from "@/lib/data/scout";
import { parseInfluencerExcel, parseInfluencerPdf } from "@/lib/scout/ingest";

export const maxDuration = 120; // backstop only — the real fix was bulk DB writes + parallel Apify run-starts (scout.ts), not a longer window

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no file provided" }, { status: 400 });
  }

  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const isExcel =
    /\.(xlsx|xls|csv)$/i.test(file.name) ||
    file.type.includes("spreadsheet") ||
    file.type === "text/csv";
  if (!isPdf && !isExcel) {
    return NextResponse.json({ error: "unsupported file type — upload a PDF or Excel/CSV sheet" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = isPdf ? await parseInfluencerPdf(buffer) : await parseInfluencerExcel(buffer);

  if (result.candidates.length === 0) {
    return NextResponse.json(
      { error: `No Instagram links found in ${file.name} (${result.rowsFound} rows scanned) — is this the right file?` },
      { status: 422 },
    );
  }

  const batch = await createScoutBatch(file.name, isPdf ? "pdf" : "excel", result.rowsFound, result.candidates);
  const { runsStarted, runsFailed } = await startScoutRuns(batch.batchId);

  return NextResponse.json({
    batchId: batch.batchId,
    expectedCount: batch.expectedCount,
    parsedCount: batch.parsedCount,
    runsStarted,
    runsFailed,
  });
}
