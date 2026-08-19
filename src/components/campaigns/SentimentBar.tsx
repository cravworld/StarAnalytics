"use client";

import { useState } from "react";
import type { CampaignSentiment, CampaignSentimentItem } from "@/lib/data/campaigns";

// Renders a partial (not "complete-looking but actually partial") aggregate — see
// AGENTS.md Phase 4 §B4. sentiment is null only when zero posts are classified yet.

// "fill" paints the bar segment, "text" the label beneath it. They used to be one
// field, which forced comparing the colour string itself to special-case
// neutral — a check that would have silently stopped matching the moment the
// palette changed, quietly turning the neutral label the wrong colour.
const LABEL_META = {
  pos: { fill: "var(--pencil-green)", text: "var(--pencil-green)", noun: "positive" },
  neu: { fill: "var(--ink-faint)", text: "var(--ink-soft)", noun: "neutral" },
  neg: { fill: "var(--pencil-red)", text: "var(--pencil-red)", noun: "negative" },
} as const;

type Label = keyof typeof LABEL_META;

function ItemList({ items }: { items: CampaignSentimentItem[] }) {
  if (items.length === 0) {
    return <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 0" }}>Nothing in this bucket.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8, maxHeight: 280, overflowY: "auto" }}>
      {items.map((item) => (
        <div
          key={item.id}
          style={{ padding: "8px 10px", background: "var(--track)", borderRadius: 6, fontSize: 12 }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            {item.externalUrl ? (
              <a href={item.externalUrl} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
                {item.handle}
              </a>
            ) : (
              <span style={{ fontWeight: 600 }}>{item.handle}</span>
            )}
            <span style={{ color: "var(--muted)" }}>{Math.round(item.score * 100)}%</span>
          </div>
          {item.caption && (
            <div style={{ color: "var(--muted)", marginTop: 4, whiteSpace: "pre-wrap" }}>
              {item.caption.length > 200 ? `${item.caption.slice(0, 200)}…` : item.caption}
            </div>
          )}
          {item.keywords.length > 0 && (
            <div style={{ marginTop: 4, color: "var(--muted)" }}>{item.keywords.join(" · ")}</div>
          )}
        </div>
      ))}
    </div>
  );
}

export function SentimentBar({
  sentiment,
  items,
}: {
  sentiment: CampaignSentiment | null;
  items: { pos: CampaignSentimentItem[]; neu: CampaignSentimentItem[]; neg: CampaignSentimentItem[] };
}) {
  const [open, setOpen] = useState<Label | null>(null);

  if (!sentiment) {
    return (
      <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 0" }}>
        Sentiment analysis pending — no posts classified yet.
      </div>
    );
  }

  const { positivePct, neutralPct, negativePct, classifiedCount, totalCount } = sentiment;
  const pct: Record<Label, number> = { pos: positivePct, neu: neutralPct, neg: negativePct };

  return (
    <div style={{ padding: "8px 0" }}>
      <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "var(--track)" }}>
        {(Object.keys(LABEL_META) as Label[]).map((label) => (
          <button
            key={label}
            type="button"
            aria-label={`Show ${LABEL_META[label].noun} posts`}
            onClick={() => setOpen((prev) => (prev === label ? null : label))}
            style={{
              width: `${pct[label]}%`,
              background: LABEL_META[label].fill,
              border: "none",
              padding: 0,
              cursor: pct[label] > 0 ? "pointer" : "default",
              opacity: open && open !== label ? 0.5 : 1,
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11 }}>
        {(Object.keys(LABEL_META) as Label[]).map((label) => (
          <button
            key={label}
            type="button"
            onClick={() => setOpen((prev) => (prev === label ? null : label))}
            disabled={items[label].length === 0}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              color: LABEL_META[label].text,
              cursor: items[label].length > 0 ? "pointer" : "default",
              fontWeight: open === label ? 700 : 400,
              textDecoration: open === label ? "underline" : "none",
            }}
          >
            {pct[label]}% {LABEL_META[label].noun}
          </button>
        ))}
      </div>
      {classifiedCount < totalCount && (
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
          {classifiedCount} of {totalCount} posts classified
        </div>
      )}
      {open && <ItemList items={items[open]} />}
    </div>
  );
}
