"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ScoutRetryButton({ batchId, missingCount }: { batchId: string; missingCount: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onRetry() {
    setPending(true);
    try {
      await fetch(`/api/scout/${batchId}/retry`, { method: "POST" });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button className="btn" onClick={onRetry} disabled={pending}>
      {pending ? "Retrying…" : `Retry ${missingCount} unscanned account${missingCount === 1 ? "" : "s"}`}
    </button>
  );
}
