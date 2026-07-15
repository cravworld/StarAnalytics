// Thin wrapper around the Apify REST API. Only ever called from
// src/lib/providers/apify-public-content.ts — route handlers and components
// must go through the PublicContentProvider seam, never this module directly.

const API_BASE = "https://api.apify.com/v2";

function actorPath(actorId: string): string {
  return actorId.replace("/", "~");
}

function token(): string {
  const t = process.env.APIFY_TOKEN;
  if (!t) throw new Error("APIFY_TOKEN is not set");
  return t;
}

export interface ApifyRunHandle {
  runId: string;
  datasetId: string;
  status: string;
}

export async function runActor(actorId: string, input: Record<string, unknown>): Promise<ApifyRunHandle> {
  const res = await fetch(`${API_BASE}/acts/${actorPath(actorId)}/runs?token=${token()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`Apify runActor(${actorId}) failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return { runId: json.data.id, datasetId: json.data.defaultDatasetId, status: json.data.status };
}

export async function getRunStatus(runId: string): Promise<{ status: string; datasetId: string }> {
  const res = await fetch(`${API_BASE}/actor-runs/${runId}?token=${token()}`);
  if (!res.ok) {
    throw new Error(`Apify getRunStatus(${runId}) failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return { status: json.data.status, datasetId: json.data.defaultDatasetId };
}

export async function getDatasetItems<T = Record<string, unknown>>(datasetId: string): Promise<T[]> {
  const res = await fetch(`${API_BASE}/datasets/${datasetId}/items?token=${token()}&format=json`);
  if (!res.ok) {
    throw new Error(`Apify getDatasetItems(${datasetId}) failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

const TERMINAL_STATUSES = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);

// Polls a run to completion. Apify actor runs for this project's volumes finish in
// seconds-to-low-minutes, so simple polling (no webhooks) is fine for Phase 1.
export async function waitForRun(
  runId: string,
  { intervalMs = 3000, timeoutMs = 5 * 60 * 1000 } = {},
): Promise<{ status: string; datasetId: string }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const run = await getRunStatus(runId);
    if (TERMINAL_STATUSES.has(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Apify run ${runId} did not finish within ${timeoutMs}ms`);
}
