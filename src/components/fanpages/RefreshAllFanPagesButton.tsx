"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { refreshAllFanPagesAction } from "@/lib/actions/fanpages";

interface Outcome {
  total: number;
  refreshed: number;
  posts: number;
  failures: { handle: string; error: string }[];
}

/**
 * Refreshes every tracked fan page in one press, instead of opening each one.
 *
 * Deliberately noisy about what it costs and how it went:
 *
 * - The count is on the button. On Instagram each page is a real Apify pull, so "Refresh
 *   all 12 pages" is a materially different decision from "Refresh all 1 page", and the
 *   number is the cheapest possible way to say so before the click rather than after.
 * - A partial run reports as partial. The action refreshes pages independently so one bad
 *   handle cannot abort the rest, which means "8 of 12" is a real and fairly common
 *   outcome — reporting it as plain success would hide exactly the pages needing attention.
 * - No confirmation dialog: this is additive and repeatable, nothing is destroyed, and the
 *   pre-click count already carries the weight.
 */
export function RefreshAllFanPagesButton({ totalTracked }: { totalTracked: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (totalTracked === 0) return null;

  async function onRefreshAll() {
    setPending(true);
    setError(null);
    setOutcome(null);
    try {
      setOutcome(await refreshAllFanPagesAction());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  const failed = outcome ? outcome.total - outcome.refreshed : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <button className="btn" onClick={onRefreshAll} disabled={pending}>
        {pending
          ? `Refreshing ${totalTracked} page${totalTracked === 1 ? "" : "s"}…`
          : `↻ Refresh all ${totalTracked} page${totalTracked === 1 ? "" : "s"}`}
      </button>

      {pending ? (
        <div style={{ fontSize: 10, color: "var(--muted)" }}>
          Pulling each page&apos;s profile and recent posts — this can take a while.
        </div>
      ) : null}

      {outcome ? (
        <div style={{ fontSize: 10, color: failed > 0 ? "var(--pencil-amber)" : "var(--muted)", textAlign: "right" }}>
          Refreshed {outcome.refreshed} of {outcome.total} · {outcome.posts} posts stored
          {outcome.failures.length > 0 ? (
            <div style={{ marginTop: 2 }}>
              {outcome.failures.map((f) => (
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
