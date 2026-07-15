"use server";

import { runAgencyAnalysis } from "@/lib/data/agency";

export async function analyseAgencyPostsAction() {
  return runAgencyAnalysis();
}
