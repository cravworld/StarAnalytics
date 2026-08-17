"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Scans finish on the poll-scout-runs cron (every 2 minutes), not this request — so a
// batch detail page left open needs to re-pull itself rather than freeze on "Scanning…"
// forever. Stops once the caller says the batch is done.
export function ScoutAutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(id);
  }, [active, router]);
  return null;
}
