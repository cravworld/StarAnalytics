"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addTrackedPostsAction } from "@/lib/actions/trackedPosts";
import type { IngestResult } from "@/lib/data/trackedPosts";

/**
 * Paste post links to track them.
 *
 * Accepts several links at once even though the brief was "I will feed links manually" —
 * the ingest function has always taken an array (so bulk upload stays a parser rather than
 * a second pipeline), and a textarea costs nothing over a single input while letting
 * someone paste a column straight out of a sheet.
 */
export function AddTrackedPostForm({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [result, setResult] = useState<IngestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit() {
    if (!text.trim()) return;
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const r = await addTrackedPostsAction(campaignId, text);
        setResult(r);
        // Only clear the box when everything landed — otherwise the operator loses the
        // links they still need to fix.
        if (r.rejected === 0 && r.duplicates === 0) setText("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  const problems = result?.outcomes.filter((o) => o.status !== "added") ?? [];

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title">Track a post</div>
      <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 8 }}>
        Paste an Instagram, Facebook or YouTube post link — one per line. The account that
        posted it is detected automatically.
      </div>
      <textarea
        rows={3}
        placeholder={"https://www.instagram.com/p/CxYz123/\nhttps://youtu.be/dQw4w9WgXcQ"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={pending}
        style={{ width: "100%", marginBottom: 8 }}
      />
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={onSubmit} disabled={pending || !text.trim()}>
          {pending ? "Fetching metrics…" : "Track posts"}
        </button>
        {result ? (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {result.added} added
            {result.duplicates > 0 ? `, ${result.duplicates} already tracked` : ""}
            {result.rejected > 0 ? `, ${result.rejected} rejected` : ""}
          </span>
        ) : null}
      </div>

      {error ? (
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--pencil-red)" }}>{error}</div>
      ) : null}

      {/* Per-link reasons, not a single "some links failed" — the reasons are actionable
          ("that's a story link", "paste the permalink instead") and useless in aggregate. */}
      {problems.length > 0 ? (
        <ul style={{ marginTop: 10, paddingLeft: 18, fontSize: 12, color: "var(--ink-soft)" }}>
          {problems.map((p, i) => (
            <li key={i} style={{ marginBottom: 4 }}>
              <code style={{ fontSize: 11 }}>{p.url}</code>
              <br />
              <span style={{ color: p.status === "rejected" ? "var(--pencil-red)" : "var(--pencil-amber)" }}>
                {p.reason}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
