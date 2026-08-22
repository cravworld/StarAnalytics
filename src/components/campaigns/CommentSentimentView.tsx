"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { KpiGrid, Kpi } from "@/components/ui/Kpi";
import { Card } from "@/components/ui/Card";
import { Sparkline } from "@/components/ui/Sparkline";
import { useTopbarExport } from "@/components/shell/TopbarExportContext";
import { toCsv } from "@/lib/csv";
import { formatIstDate } from "@/lib/format";
import type { CommentSentimentInsights } from "@/lib/data/commentSentimentInsights";

// This screen was written before the notebook redesign landed, so it carried the old
// palette's red as a literal. --pencil-red is the redesign's semantic negative: measured
// at 10.4:1 on a card, and separated from the positive green on two channels (dE 27.7 and
// a 2.07:1 luminance ratio) so "negative" survives colour-blindness.
const NEG = "var(--pencil-red)";
const MUTED = "var(--muted)";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return formatIstDate(iso);
}

export function CommentSentimentView({ data }: { data: CommentSentimentInsights }) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data.negativeComments;
    return data.negativeComments.filter(
      (c) => (c.text ?? "").toLowerCase().includes(q) || (c.authorHandle ?? "").toLowerCase().includes(q),
    );
  }, [data.negativeComments, query]);

  // Memoized against `filtered` specifically — an inline csv closure would change identity
  // every render and drive useTopbarExport's effect into a re-render loop. See
  // OwnCampaignsList.tsx, where that exact bug was found live.
  const exportConfig = useMemo(
    () => ({
      filename: "negative-comments.csv",
      csv: () =>
        toCsv(
          ["Handle", "Confidence", "Comment", "Commented", "Campaign", "Post"],
          filtered.map((c) => [
            c.authorHandle ?? "",
            c.score,
            c.text ?? "(text cleared by retention policy)",
            c.commentedAt ?? "",
            c.campaignName ?? "",
            c.postExternalUrl ?? "",
          ]),
        ),
    }),
    [filtered],
  );
  useTopbarExport(exportConfig);

  function onCampaignChange(id: string) {
    router.push(id ? `/campaigns/comments?campaign=${id}` : "/campaigns/comments");
  }

  const { totals, coverage } = data;
  const noData = totals.classified === 0;

  return (
    <>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <input
          placeholder="Filter negative comments by text or handle…"
          style={{ flex: 1 }}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={data.campaignId ?? ""} onChange={(e) => onCampaignChange(e.target.value)}>
          <option value="">All Campaigns</option>
          {data.campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <KpiGrid cols={4}>
        <Kpi label="Comments Classified" value={String(totals.classified)} delta={`${totals.distinctCommenters} distinct commenters`} />
        <Kpi
          label="Negative"
          value={`${totals.negativePct}%`}
          delta={`${totals.negative} comment${totals.negative === 1 ? "" : "s"}`}
          valueColor={totals.negative > 0 ? NEG : undefined}
        />
        <Kpi label="Positive" value={`${totals.classified ? Math.round((totals.positive / totals.classified) * 100) : 0}%`} delta={`${totals.positive} comments`} />
        <Kpi
          label="Repeat Critics"
          value={String(data.repeatCritics.length)}
          delta="2+ negative comments"
        />
      </KpiGrid>

      <Card title="Negative Rate — last 14 days">
        {noData ? (
          <div style={{ fontSize: 12, color: MUTED, padding: "8px 0" }}>
            No classified comments yet in this view.
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <Sparkline values={data.negativeRateTrend.map((p) => p.negative)} width={220} height={40} />
            <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.6 }}>
              Negative comments per day, by when the comment was posted (not when it was
              classified). Days with no captured comments read as zero — that is absence of
              data, not absence of criticism.
            </div>
          </div>
        )}
      </Card>

      <Card title={`What people are actually saying${data.negativeCommentsTruncated ? " (newest 100)" : ""}`}>
        {totals.negative === 0 ? (
          <div style={{ fontSize: 12, color: MUTED, padding: "8px 0" }}>
            No negative comments captured in this view.
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ fontSize: 12, color: MUTED, padding: "8px 0" }}>No comments match your filter.</div>
        ) : (
          <div>
            {filtered.map((c) => (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  gap: 14,
                  padding: "10px 0",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 13,
                }}
              >
                <div style={{ width: 4, borderRadius: 2, background: NEG, flexShrink: 0 }} aria-hidden />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600 }}>@{c.authorHandle ?? "unknown"}</span>
                    <span style={{ fontSize: 11, color: MUTED }}>{fmtDate(c.commentedAt)}</span>
                    {c.campaignName ? <span style={{ fontSize: 11, color: MUTED }}>· {c.campaignName}</span> : null}
                    {c.postExternalUrl ? (
                      <a href={c.postExternalUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11 }}>
                        view post{c.postAuthorHandle ? ` by @${c.postAuthorHandle}` : ""} ↗
                      </a>
                    ) : null}
                  </div>
                  <div style={{ marginTop: 3, wordBreak: "break-word" }}>
                    {c.text ?? (
                      <em style={{ color: MUTED }}>
                        Comment text cleared by the 90-day retention policy — the classification is kept, the words are not.
                      </em>
                    )}
                  </div>
                </div>
                {/* Confidence, not severity. Labelled explicitly so nobody reads 0.9 as
                    "worse" than 0.6 — it means the classifier was surer, not that the
                    comment was harsher. */}
                <div style={{ fontSize: 11, color: MUTED, flexShrink: 0 }} title="Classifier confidence, not severity">
                  {Math.round(c.score * 100)}% conf.
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Repeat critics">
        {data.repeatCritics.length === 0 ? (
          <div style={{ fontSize: 12, color: MUTED, padding: "8px 0", lineHeight: 1.6 }}>
            Nobody has left more than one negative comment in this view. Every negative
            comment captured so far comes from a different account, so there is no
            repeat-offender pattern to act on — this panel fills in on its own if that changes.
          </div>
        ) : (
          <div>
            {data.repeatCritics.map((r) => (
              <div
                key={r.authorHandle}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: "8px 0",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 13,
                }}
              >
                <div style={{ flex: 1, fontWeight: 600 }}>@{r.authorHandle}</div>
                <div style={{ width: 130, textAlign: "right", color: MUTED }}>
                  {r.negativeCount} negative
                </div>
                <div style={{ width: 110, textAlign: "right", color: MUTED }}>
                  across {r.postCount} post{r.postCount === 1 ? "" : "s"}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Not a footnote — without it the headline percentage reads as a fact about the
          audience when it is substantially a fact about what the pipeline collects. */}
      <Card title="How much of the conversation this covers">
        <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.7 }}>
          <div>
            <strong style={{ color: "var(--fg)" }}>
              {coverage.postsWithComments} of {coverage.postsEligible}
            </strong>{" "}
            eligible posts have any captured comments ({coverage.commentsStored} comments stored
            {coverage.commentsUnclassified > 0 ? `, ${coverage.commentsUnclassified} awaiting classification` : ", all classified"}).
          </div>
          <div style={{ marginTop: 8 }}>
            Three limits shape these numbers, and all three under-count criticism specifically:
            comments are scraped only for campaign and agency posts; each post is scraped
            <strong style={{ color: "var(--fg)" }}> once, ever</strong>, so late-arriving
            comments are never picked up; and <strong style={{ color: "var(--fg)" }}>replies are
            not scraped at all</strong>, which is where pile-ons usually happen. Widening any of
            these costs Apify credit — see APIFY-USAGE-AUDIT.md.
          </div>
        </div>
      </Card>
    </>
  );
}
