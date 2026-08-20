"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  pullFanPageHistoryAction,
  setFanPageVerifiedAction,
  stopTrackingFanPageAction,
} from "@/lib/actions/fanpages";

/**
 * The three things you can actually do to a tracked fan page.
 *
 * "Refresh" is the only one that costs anything — on Instagram it is a real Apify profile +
 * post-history call — which is exactly why it lives behind a button here instead of running
 * when the screen renders. The label carries the post cap so the spend is never a surprise.
 *
 * "Stop tracking" confirms in place rather than through window.confirm: a native modal
 * blocks the whole page (and every automated check that ever drives this screen), and a
 * two-step button gives the same protection without one.
 */
export function FanPageActions({
  id,
  platform,
  isVerifiedFan,
  lastCheckedLabel,
}: {
  id: string;
  platform: string;
  isVerifiedFan: boolean;
  lastCheckedLabel: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<null | "pull" | "verify" | "stop">(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pulled, setPulled] = useState<number | null>(null);

  // The checkbox renders from local state, not straight from the server prop.
  //
  // Bound directly to the prop it could not move until the write AND a full RSC refresh had
  // come back: clicking it made React immediately re-render with the OLD value, so the tick
  // visibly snapped back and then flipped ~2.5s later (measured). That reads as a dead
  // control, and the natural response is to click it again — which fires a second write.
  // Local state flips on click, the server call follows, and a failure puts it back.
  const [verified, setVerified] = useState(isVerifiedFan);
  // Re-sync when the server sends a different value: a refresh landing after some other
  // change, or another tab. Same value in means no re-render, so this cannot fight the
  // optimistic flip above.
  useEffect(() => setVerified(isVerifiedFan), [isVerifiedFan]);

  async function onToggleVerified(next: boolean) {
    setVerified(next); // instant feedback — this is the whole point
    setPending("verify");
    setError(null);
    try {
      await setFanPageVerifiedAction(id, next);
      router.refresh();
    } catch (e) {
      setVerified(!next); // put the tick back; the write did not happen
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  }

  async function run(kind: "pull" | "verify" | "stop", fn: () => Promise<void>) {
    setPending(kind);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <label
          style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--muted)" }}
        >
          <input
            type="checkbox"
            checked={verified}
            // Only the long-running actions lock it. Disabling on its own write was part of
            // what made the control feel dead — the click had no visible effect and the box
            // greyed out for the round trip.
            disabled={pending === "pull" || pending === "stop"}
            style={{ width: "auto", padding: 0 }}
            onChange={(e) => onToggleVerified(e.target.checked)}
          />
          Verified fan
        </label>

        <button
          className="btn btn-primary"
          disabled={pending !== null}
          onClick={() =>
            run("pull", async () => {
              const { postCount } = await pullFanPageHistoryAction(id);
              setPulled(postCount);
            })
          }
        >
          {pending === "pull" ? "Pulling…" : "↻ Refresh data"}
        </button>

        {confirmStop ? (
          <>
            <button
              className="btn"
              disabled={pending !== null}
              style={{ color: "var(--pencil-red)", borderColor: "var(--pencil-red)" }}
              onClick={() =>
                run("stop", async () => {
                  await stopTrackingFanPageAction(id);
                  router.push("/fan-pages");
                })
              }
            >
              {pending === "stop" ? "Stopping…" : "Confirm stop"}
            </button>
            <button className="btn" disabled={pending !== null} onClick={() => setConfirmStop(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button className="btn" disabled={pending !== null} onClick={() => setConfirmStop(true)}>
            Stop tracking
          </button>
        )}
      </div>

      <div style={{ fontSize: 10, color: "var(--muted)", textAlign: "right" }}>
        {pulled !== null
          ? `Pulled ${pulled} post${pulled === 1 ? "" : "s"} — sentiment is classifying in the background.`
          : lastCheckedLabel
            ? `Last pulled ${lastCheckedLabel} · refresh fetches up to 50 recent posts${platform === "instagram" ? " (Apify)" : ""}`
            : `Never pulled · refresh fetches up to 50 recent posts${platform === "instagram" ? " (Apify)" : ""}`}
      </div>

      {error ? <div style={{ color: "var(--pencil-red)", fontSize: 11 }}>{error}</div> : null}
    </div>
  );
}
