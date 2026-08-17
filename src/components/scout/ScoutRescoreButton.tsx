"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Re-applies the *current* Scan Settings weights to this batch's already-scraped data — no
// new Apify run, no new cost. Useful after tuning the Buzz Factor weights and wanting to see
// how an existing leaderboard would re-rank under them.
export function ScoutRescoreButton({ batchId }: { batchId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onRescore() {
    setPending(true);
    try {
      await fetch(`/api/scout/${batchId}/rescore`, { method: "POST" });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button className="btn" onClick={onRescore} disabled={pending} title="Re-rank this batch using the current Scan Settings weights — no new scrape, no new cost">
      {pending ? "Re-scoring…" : "Re-score with current weights"}
    </button>
  );
}
