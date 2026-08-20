"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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
            checked={isVerifiedFan}
            disabled={pending !== null}
            style={{ width: "auto", padding: 0 }}
            onChange={(e) =>
              run("verify", () => setFanPageVerifiedAction(id, e.target.checked))
            }
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
