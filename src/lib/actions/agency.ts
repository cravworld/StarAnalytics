"use server";

import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAgencyResults, runAgencyBatchJob } from "@/lib/data/agency";
import type { AgencyUrlRow } from "@/lib/upload/parseAgencySheet";

// Fire-and-forget: a few hundred URLs across several Apify runs won't finish
// inside a normal request/response cycle. after() runs the batch job once the
// response has been sent (see the agency page's maxDuration export), and the
// client polls /api/agency-run/[id]/status for progress.
export async function analyseAgencyPostsAction(rows: AgencyUrlRow[]) {
  const run = await prisma.scrapeRun.create({ data: { kind: "agency_batch", status: "queued" } });
  after(() => runAgencyBatchJob(run.id, rows));
  return { runId: run.id };
}

export async function getAgencyRunResultsAction(runId: string) {
  return getAgencyResults(runId);
}
