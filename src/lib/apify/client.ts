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

export interface RunActorOptions {
  /** Per-run spend ceiling in USD — Apify aborts the run itself once hit. Additive, optional:
   * every pre-existing caller keeps its old (uncapped) behavior unless it opts in. */
  maxChargeUsd?: number;
  /** Server-side run timeout in seconds — bounds how long a run can bill for if nobody
   * ever reads its status again. */
  timeoutSecs?: number;
}

export async function runActor(
  actorId: string,
  input: Record<string, unknown>,
  options: RunActorOptions = {},
): Promise<ApifyRunHandle> {
  const params = new URLSearchParams({ token: token() });
  if (options.maxChargeUsd !== undefined) params.set("maxTotalChargeUsd", String(options.maxChargeUsd));
  if (options.timeoutSecs !== undefined) params.set("timeout", String(Math.ceil(options.timeoutSecs)));
  const res = await fetch(`${API_BASE}/acts/${actorPath(actorId)}/runs?${params}`, {
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

// Polls a run to completion. Was 5 minutes, sized for the old 15-comment-cap era where
// every comment scrape was small and fast. Raised since — even under the current bounded
// COMMENTS_PER_POST_LIMIT (see apify-public-content.ts) — a batched run covering many posts
// at once can take real actor runtime well past 5 minutes, and the calling routes now run at
// up to 1800s maxDuration specifically to have room for this. Still well under that ceiling,
// leaving time for classification afterward.
export async function waitForRun(
  runId: string,
  { intervalMs = 3000, timeoutMs = 20 * 60 * 1000 } = {},
): Promise<{ status: string; datasetId: string }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const run = await getRunStatus(runId);
    if (TERMINAL_STATUSES.has(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Apify run ${runId} did not finish within ${timeoutMs}ms`);
}
