"use client";

import { useState } from "react";
import { sendWeeklyDigestNowAction } from "@/lib/actions/campaigns";

// Same pending/error pattern as every other action-triggering component in this app
// (TrackHashtagForm, CampaignTimeline) — this one has no form fields, just a single button,
// but the result also isn't binary success/failure: sendWeeklyDigest() can genuinely have
// nothing to send (zero live campaigns) without that being an error, so the three outcomes
// (sent / nothing-to-send / genuine failure) each get their own honest message.
export function SendDigestNowButton() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const { sent, campaignCount } = await sendWeeklyDigestNowAction();
      if (sent) {
        setResult(`Sent — ${campaignCount} live campaign${campaignCount === 1 ? "" : "s"}.`);
      } else if (campaignCount === 0) {
        setResult("No live campaigns to report — nothing sent.");
      } else {
        setResult("Send failed — check server logs for the delivery error.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button className="tb-btn" onClick={onClick} disabled={pending}>
        {pending ? "Sending…" : "Send Digest Now"}
      </button>
      {result ? <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{result}</div> : null}
      {error ? <div style={{ fontSize: 11, color: "var(--red)", marginTop: 4 }}>{error}</div> : null}
    </div>
  );
}
