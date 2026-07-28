"use server";

import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAgencyResults, runAgencyBatchJob } from "@/lib/data/agency";
import { requireSession } from "@/lib/require-session";
import { IG_POST_URL_RE, type AgencyUrlRow } from "@/lib/upload/parseAgencySheet";

// Fire-and-forget: a few hundred URLs across several Apify runs won't finish
// inside a normal request/response cycle. after() runs the batch job once the
// response has been sent (see the agency page's maxDuration export), and the
// client polls /api/agency-run/[id]/status for progress.
export async function analyseAgencyPostsAction(rows: AgencyUrlRow[]) {
  await requireSession();

  // parseAgencySheet.ts's validation runs in the browser and is a UX nicety, not
  // a security boundary — this action is reachable directly, so re-validate every
  // row server-side before any of it reaches Apify's actor input.
  const validRows = rows.filter((r) => r.agencyName?.trim() && IG_POST_URL_RE.test(r.url ?? ""));

  const run = await prisma.scrapeRun.create({ data: { kind: "agency_batch", status: "queued" } });
  after(() => runAgencyBatchJob(run.id, validRows));
  return { runId: run.id };
}

export async function getAgencyRunResultsAction(runId: string) {
  await requireSession();
  return getAgencyResults(runId);
}
