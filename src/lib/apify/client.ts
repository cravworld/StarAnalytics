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

/**
 * Every call here goes to a third party over the network, and undici applies no response
 * timeout of its own — a hung api.apify.com would otherwise hang the caller until the
 * platform kills it. That is merely slow inside a cron job, but `readAccountUsage` is
 * reached from a page render (the pipeline health banner), where it would hang every
 * authenticated page load.
 *
 * Generous by default because a run start or a large dataset read is legitimately slow;
 * `readAccountUsage` passes a much tighter budget since it sits on the render path.
 */
async function apiFetch(url: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

export interface ApifyRunHandle {
  runId: string;
  datasetId: string;
  status: string;
}

/**
 * How long we're willing to sit on a run before giving up on it.
 *
 * Was 20 minutes, which no caller could actually reach: every route that starts a scrape
 * had a shorter Vercel `maxDuration` than that (the agency/campaign pages were 300s,
 * poll-hashtags 800s), so the function was always killed first — mid-wait, with no
 * catch/finally running. Those pages are 800s now, but the principle stands: this must
 * stay comfortably inside the smallest caller's ceiling, with room for the work that runs
 * before and after it. 5 minutes does; callers with less room pass their own budget.
 */
export const DEFAULT_WAIT_MS = 5 * 60 * 1000;

/**
 * Hard ceiling on what any single actor run may charge, enforced by Apify itself via
 * the `maxTotalChargeUsd` run option rather than by anything we can forget to check.
 *
 * This exists because every one of our actors is now PAY_PER_EVENT and bills per
 * dataset item: the comment scraper's `resultsLimit` is applied PER URL (confirmed
 * against its input schema — "If set to 5, you will get 5 comments per URL"), so a
 * batched run's cost scales with urls × limit, which nothing in the input caps.
 *
 * $6 is ~2,300 items at the worst-case $0.0026/item tier — above any run this codebase
 * sizes (the largest, a full 10-post comment batch, tops out at $5.72 with headroom) and
 * far below the kind of number an unbounded batch reaches. It is the runaway guard, not
 * the working budget; callers pass their own computed cap and this is the backstop when
 * they don't.
 *
 * Sized so the clamp never binds on a legitimate run, deliberately. A cap that truncates
 * a real comment batch is worse than one that's slightly loose: the posts in that batch
 * are already marked commentsScrapedAt by the time it aborts, so they would never be
 * retried and the missing comments would be lost silently and permanently.
 *
 * Apify aborts the run when the cap is reached, so hitting it costs exactly the cap
 * and never more. Env-configurable: a policy knob, not a redeploy.
 */
export const DEFAULT_MAX_CHARGE_USD = Number(process.env.APIFY_MAX_CHARGE_USD_PER_RUN) || 6;

export interface RunActorOptions {
  /** Per-run spend ceiling in USD. Defaults to DEFAULT_MAX_CHARGE_USD. */
  maxChargeUsd?: number;
  /**
   * Server-side run timeout in seconds. Defaults to the wait budget plus a grace
   * period, so Apify kills an abandoned run even if our own abort call never lands.
   */
  timeoutSecs?: number;
}

/**
 * Both options here are belt-and-braces against the same failure: a run we stop
 * watching but keep paying for.
 *
 * Without an explicit `timeout`, a run inherits the actor's own default — which is
 * 30,000s (8.3 hours) for the comment and profile scrapers and 20,000s for the post
 * scraper. A serverless function killed at 300s used to leave a run billing for the
 * rest of that window with nobody left to read its dataset.
 */
export async function runActor(
  actorId: string,
  input: Record<string, unknown>,
  { maxChargeUsd = DEFAULT_MAX_CHARGE_USD, timeoutSecs }: RunActorOptions = {},
): Promise<ApifyRunHandle> {
  const params = new URLSearchParams({
    token: token(),
    maxTotalChargeUsd: String(maxChargeUsd),
    timeout: String(Math.ceil(timeoutSecs ?? DEFAULT_WAIT_MS / 1000 + 60)),
  });
  const res = await apiFetch(`${API_BASE}/acts/${actorPath(actorId)}/runs?${params}`, {
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
  const res = await apiFetch(`${API_BASE}/actor-runs/${runId}?token=${token()}`);
  if (!res.ok) {
    throw new Error(`Apify getRunStatus(${runId}) failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return { status: json.data.status, datasetId: json.data.defaultDatasetId };
}

/**
 * Best-effort stop. Deliberately never throws: it's called from the give-up path, and
 * an abort that fails must not mask the real "this run didn't finish" error. The
 * `timeout` passed at start time is the backstop for exactly that case.
 */
export async function abortRun(runId: string): Promise<void> {
  try {
    const res = await apiFetch(`${API_BASE}/actor-runs/${runId}/abort?token=${token()}`, { method: "POST" });
    if (!res.ok && res.status !== 400) {
      // 400 is Apify's "run is already in a terminal state" — not a failure to care about.
      console.error(`Apify abortRun(${runId}) failed: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error(`Apify abortRun(${runId}) threw:`, err);
  }
}

// Dataset reads are unmetered, but the response is a single unbounded JSON body parsed
// into a serverless function's memory — bound it rather than trusting the run to have
// stayed small.
const DATASET_ITEM_LIMIT = Number(process.env.APIFY_DATASET_ITEM_LIMIT) || 10_000;

export async function getDatasetItems<T = Record<string, unknown>>(datasetId: string): Promise<T[]> {
  const params = new URLSearchParams({
    token: token(),
    format: "json",
    limit: String(DATASET_ITEM_LIMIT),
  });
  const res = await apiFetch(`${API_BASE}/datasets/${datasetId}/items?${params}`, {}, 60_000);
  if (!res.ok) {
    throw new Error(`Apify getDatasetItems(${datasetId}) failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export interface ApifyAccountUsage {
  monthlyUsageUsd: number;
  maxMonthlyUsageUsd: number;
}

/**
 * Account-level spend against the plan cap. Unmetered platform call, not an actor run.
 *
 * This is the only signal that catches the cap being reached *between* runs rather than
 * on a run start — the case the 403-based circuit breaker structurally cannot see (a run
 * that starts fine and is then aborted by the platform reports a generic FAILED/ABORTED
 * status with no quota marker anywhere in it).
 *
 * Returns null rather than throwing when the API is unreachable: an unavailable usage
 * endpoint must not be able to halt the whole pipeline, since the 403 breaker still
 * covers the start-time case on its own.
 *
 * The tight timeout is load-bearing, not tidiness. This is reached from a page render via
 * the pipeline health banner, so a hung Apify API would otherwise hang every authenticated
 * page load. A timeout lands on the same catch as any other failure — i.e. straight onto
 * the fail-open path — so the worst case is a 3-second render, not an unbounded one.
 */
const USAGE_TIMEOUT_MS = 3_000;

export async function readAccountUsage(): Promise<ApifyAccountUsage | null> {
  try {
    const res = await apiFetch(`${API_BASE}/users/me/limits?token=${token()}`, {}, USAGE_TIMEOUT_MS);
    if (!res.ok) return null;
    const json = await res.json();
    const monthlyUsageUsd = json?.data?.current?.monthlyUsageUsd;
    const maxMonthlyUsageUsd = json?.data?.limits?.maxMonthlyUsageUsd;
    if (typeof monthlyUsageUsd !== "number" || typeof maxMonthlyUsageUsd !== "number") return null;
    return { monthlyUsageUsd, maxMonthlyUsageUsd };
  } catch (err) {
    console.error("Apify readAccountUsage failed:", err);
    return null;
  }
}

const TERMINAL_STATUSES = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);

/**
 * Polls a run to completion, and aborts it if we give up first.
 *
 * The abort is the point. Throwing alone left the run executing on Apify's own default
 * timeout (up to 8.3 hours) with nobody reading its dataset — billed in full, stored
 * nowhere, and re-scraped from scratch by the next tick. Callers must size `timeoutMs`
 * below their own route `maxDuration`, or Vercel kills the function before this code
 * gets the chance to abort anything.
 */
export async function waitForRun(
  runId: string,
  { intervalMs = 5000, timeoutMs = DEFAULT_WAIT_MS, maxConsecutiveErrors = 3 } = {},
): Promise<{ status: string; datasetId: string }> {
  const start = Date.now();
  let consecutiveErrors = 0;
  while (Date.now() - start < timeoutMs) {
    try {
      const run = await getRunStatus(runId);
      consecutiveErrors = 0;
      if (TERMINAL_STATUSES.has(run.status)) return run;
    } catch (err) {
      // A status poll failing is not the run failing. Letting one blip (or one 30s fetch
      // timeout) propagate would abandon a run that is executing perfectly well — billed
      // in full, dataset never read. Tolerate a few, then give up through the same path
      // as a real timeout so the run still gets aborted rather than orphaned.
      consecutiveErrors++;
      console.error(
        `Apify waitForRun(${runId}): status poll failed (${consecutiveErrors}/${maxConsecutiveErrors}):`,
        err,
      );
      if (consecutiveErrors >= maxConsecutiveErrors) {
        await abortRun(runId);
        throw new Error(`Apify run ${runId} status could not be read ${consecutiveErrors} times — aborted`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  await abortRun(runId);
  throw new Error(`Apify run ${runId} did not finish within ${timeoutMs}ms — aborted`);
}
