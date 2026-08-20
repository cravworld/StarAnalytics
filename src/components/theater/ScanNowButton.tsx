"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Manual "Scan now".
 *
 * Posts to the scan route rather than calling a Server Action: a Kerala-wide scan renders
 * ~90 pages and needs the route's own maxDuration. The button stays disabled for the whole
 * request — the server also holds a per-campaign lock, but a disabled button is the honest
 * signal to the person clicking it.
 */
export function ScanNowButton({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function scan() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/theater-campaigns/${campaignId}/scan`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `Scan failed (${res.status}).`);
      } else if (body.status === "partial") {
        setError(
          `Scan finished with gaps — ${body.citiesSucceeded} of ${body.citiesRequested} city pages could be read. The rest are marked as not scanned, not as empty.`,
        );
      }
      startTransition(() => router.refresh());
    } catch {
      setError("Could not reach the server to start a scan.");
    } finally {
      setRunning(false);
    }
  }

  const busy = running || pending;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
      <button className="btn btn-primary" onClick={scan} disabled={busy} aria-busy={busy}>
        {busy ? "Scanning…" : "Run scan now"}
      </button>
      {error ? (
        <div role="alert" style={{ fontSize: 11, color: "var(--pencil-red)", maxWidth: 340, textAlign: "right" }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
