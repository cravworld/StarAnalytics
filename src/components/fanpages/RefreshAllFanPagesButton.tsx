"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { refreshFanPagesChunkAction } from "@/lib/actions/fanpages";

/** Enough to name a page in a failure line — the id to refresh it, the handle to report it. */
interface FanPageRef {
  id: string;
  handle: string;
}

/**
 * Consecutive failures that mean "something systemic is wrong" rather than "this page is slow".
 * One page failing is routine; three in a row is an expired session or a down deploy, and
 * grinding through the remaining thirty requests would just repeat it thirty times.
 */
const CONSECUTIVE_FAILURE_LIMIT = 3;

interface Tally {
  refreshed: number;
  posts: number;
  failures: { handle: string; error: string }[];
  stopped: boolean;
}

/**
 * Refreshes every tracked fan page in one press, instead of opening each one.
 *
 * WHY THIS WALKS THE PAGES INSTEAD OF ASKING FOR THEM ALL AT ONCE:
 *
 * It used to call one Server Action that looped every page server-side, and that worked until
 * there were enough pages to matter. The request is bounded by the hosting page's maxDuration
 * (800s) while a single Instagram page can take ~600s of it — two Apify runs at DEFAULT_WAIT_MS
 * each, plus the comment scrape. At 33 tracked pages it could not finish: the function was killed
 * at the limit, the browser got a 504, and because the response never arrived the outcome
 * reported nothing at all. Worse than a plain failure — the pages the loop had already reached
 * *were* refreshed and committed, so the screen was left in a state the user had no way to read.
 *
 * Now the client walks the ids a chunk at a time, so every request is the size of the per-page
 * refresh button that has always worked, and the run reports progress as it goes.
 *
 * Deliberately noisy about what it costs and how it went:
 *
 * - The count is on the button. Each Instagram page is a real Apify pull, so "Refresh all 33
 *   pages" is a materially different decision from "Refresh all 1 page", and the number is the
 *   cheapest possible way to say so before the click rather than after.
 * - A partial run reports as partial. Pages refresh independently so one bad handle cannot abort
 *   the rest, which makes "29 of 33" a real and fairly common outcome; reporting it as plain
 *   success would hide exactly the pages needing attention.
 * - It can be stopped, and a stopped or failed run keeps everything already refreshed.
 * - No confirmation dialog: this is additive and repeatable, nothing is destroyed, and the
 *   pre-click count already carries the weight.
 */
export function RefreshAllFanPagesButton({ pages }: { pages: FanPageRef[] }) {
  const router = useRouter();
  const [done, setDone] = useState<number | null>(null);
  const [tally, setTally] = useState<Tally | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A ref, not state: the loop reads this between chunks and would otherwise close over a stale
  // copy for its whole run.
  const stopRequested = useRef(false);

  const total = pages.length;
  const pending = done !== null;

  if (total === 0) return null;

  async function onRefreshAll() {
    stopRequested.current = false;
    setError(null);
    setTally(null);
    setDone(0);

    const running: Tally = { refreshed: 0, posts: 0, failures: [], stopped: false };

    // Consecutive, not total. One page timing out is normal on a slow profile and must not end
    // the run; the whole session having expired, or the deploy being down, makes every remaining
    // request fail the same way and should stop rather than grind through 30 more.
    let consecutiveFailures = 0;

    try {
      for (let i = 0; i < total; i++) {
        if (stopRequested.current) {
          running.stopped = true;
          break;
        }
        setDone(i);
        // Per page, NOT around the loop. The action can still throw for reasons the server-side
        // per-page handling cannot convert into a result — a request that exceeds maxDuration
        // (one very slow page is ~600s of scrape plus up to ~600s of comment scrape, and the
        // budget is 800s), a dropped connection, an expired session. Caught around the loop,
        // any one of those abandoned every page after it, which is the same "half the work
        // silently missing" failure this whole change exists to remove.
        try {
          // Revalidate on the final page only — see the note on refreshFanPagesChunkAction.
          const outcome = await refreshFanPagesChunkAction([pages[i].id], i === total - 1);
          running.refreshed += outcome.refreshed;
          running.posts += outcome.posts;
          running.failures.push(...outcome.failures);
          consecutiveFailures = 0;
        } catch (e) {
          running.failures.push({
            handle: pages[i].handle,
            error: e instanceof Error ? e.message : String(e),
          });
          if (++consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
            running.stopped = true;
            setError(
              `Stopped after ${CONSECUTIVE_FAILURE_LIMIT} failures in a row — the remaining pages were not attempted. Reload and try again.`,
            );
            setTally({ ...running, failures: [...running.failures] });
            break;
          }
        }
        // Committed per page, so a stop or a mid-run failure still shows what was achieved.
        setTally({ ...running, failures: [...running.failures] });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      // Runs on every exit path — the list must end up showing whatever did get refreshed.
      router.refresh();
      setDone(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {pending ? (
          <button className="btn" onClick={() => (stopRequested.current = true)}>
            Stop
          </button>
        ) : null}
        <button className="btn" onClick={onRefreshAll} disabled={pending}>
          {pending
            ? `Refreshing ${done + 1} of ${total}…`
            : `↻ Refresh all ${total} page${total === 1 ? "" : "s"}`}
        </button>
      </div>

      {pending ? (
        <div style={{ fontSize: 10, color: "var(--muted)" }}>
          Pulling each page&apos;s profile and recent posts — this can take a while. You can leave
          it running, or stop after the page in flight.
        </div>
      ) : null}

      {tally ? (
        <div
          style={{
            marginTop: 4,
            padding: "6px 10px",
            border: "1px solid var(--border)",
            borderLeft: `3px solid ${tally.failures.length > 0 ? "var(--pencil-amber)" : "var(--green, var(--muted))"}`,
            borderRadius: 4,
            textAlign: "right",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700 }}>
            {pending
              ? `Refreshed ${tally.refreshed} of ${total}…`
              : tally.stopped
                ? `Stopped — refreshed ${tally.refreshed} of ${total}`
                : `Done — refreshed ${tally.refreshed} of ${total}`}
          </div>
          <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
            {tally.posts} posts stored
            {tally.failures.length > 0 ? ` · ${tally.failures.length} failed` : ""}
          </div>
          {tally.failures.length > 0 ? (
            <div style={{ fontSize: 10, color: "var(--pencil-amber)", marginTop: 4 }}>
              {tally.failures.map((f) => (
                <div key={f.handle}>
                  @{f.handle}: {f.error}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? <div style={{ color: "var(--pencil-red)", fontSize: 11 }}>{error}</div> : null}
    </div>
  );
}
