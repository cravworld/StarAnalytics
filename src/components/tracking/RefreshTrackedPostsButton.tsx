"use client";

import { useState, useTransition } from "react";
import { refreshTrackedPostsAction } from "@/lib/actions/trackedPosts";

/**
 * Re-scrape every tracked post in the campaign.
 *
 * The action defers the actual scrape with after(), so this returns immediately and the
 * numbers land on a later page load. Says exactly that rather than showing a spinner that
 * implies the work finished — the alternative (polling a run row) is Phase 2 work, and a
 * button that lies about being done is worse than one that tells you to come back.
 */
export function RefreshTrackedPostsButton({ campaignId }: { campaignId: string }) {
  const [started, setStarted] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <button
        className="btn"
        disabled={pending || started}
        onClick={() =>
          startTransition(async () => {
            await refreshTrackedPostsAction(campaignId);
            setStarted(true);
          })
        }
      >
        {pending ? "Starting…" : started ? "Refresh started" : "Refresh metrics"}
      </button>
      {started ? (
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          Running in the background — reload in a minute to see updated numbers.
        </span>
      ) : null}
    </div>
  );
}
