"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPostCampaignInclusionAction } from "@/lib/actions/trackedPosts";
import { formatCompactNumber } from "@/lib/format";
import type { TrackedPostView } from "@/lib/data/trackedPosts";

/**
 * Posts a subscribed page published that don't carry a campaign hashtag.
 *
 * The reason this panel exists rather than these posts being filtered away at ingest: an
 * influencer who simply forgot the hashtag is indistinguishable, in the data, from someone
 * who posted about their holiday. Filtering would silently drop the first case and nobody
 * would ever know what was missed. Showing them — not counted, but visible and one click
 * from counting — makes the uncertainty something the operator can resolve instead of
 * something the code guesses at.
 *
 * Collapsed by default: it's a secondary list, and an influencer's own feed can be long.
 */
export function OtherPostsPanel({
  campaignId,
  posts,
  hashtags,
}: {
  campaignId: string;
  posts: TrackedPostView[];
  hashtags: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (posts.length === 0) return null;

  function include(postId: string) {
    setPendingId(postId);
    startTransition(async () => {
      await setPostCampaignInclusionAction(campaignId, postId, true);
      setPendingId(null);
      router.refresh();
    });
  }

  const tagList = hashtags.length ? hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(", ") : null;

  return (
    <div style={{ marginTop: 12, borderTop: "1px solid var(--rule)", paddingTop: 10 }}>
      <button
        className="btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ fontSize: 12 }}
      >
        {open ? "▾" : "▸"} {posts.length} other post{posts.length === 1 ? "" : "s"} from this page — not counted
      </button>

      {open ? (
        <>
          <div style={{ fontSize: 11, color: "var(--muted)", margin: "8px 0", lineHeight: 1.5 }}>
            These were published by this page but don&apos;t mention{" "}
            {tagList ? <strong>{tagList}</strong> : "a campaign hashtag"}, so they aren&apos;t in the
            campaign totals. If one of them is campaign work, count it.
          </div>
          <div className="tbl-scroll">
            <table className="post-tbl">
              <thead>
                <tr>
                  <th>Posted</th>
                  <th>Caption</th>
                  <th>Likes</th>
                  <th>Comments</th>
                  <th>Plays</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {posts.map((p) => (
                  <tr key={p.id}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {p.postedAt
                        ? p.postedAt.toLocaleDateString("en-IN", { day: "numeric", month: "short" })
                        : "—"}
                    </td>
                    <td style={{ maxWidth: 320 }}>
                      <a href={p.url} target="_blank" rel="noopener noreferrer">
                        {p.caption ? p.caption.slice(0, 70) + (p.caption.length > 70 ? "…" : "") : "(no caption)"}
                      </a>
                    </td>
                    {/* Same null discipline as everywhere else: "—" is not zero. */}
                    <td>{p.likes === null ? "—" : formatCompactNumber(p.likes)}</td>
                    <td>{p.comments === null ? "—" : formatCompactNumber(p.comments)}</td>
                    <td>{p.views === null ? "—" : formatCompactNumber(p.views)}</td>
                    <td>
                      <button
                        className="btn"
                        style={{ fontSize: 11, padding: "3px 8px" }}
                        disabled={pendingId === p.id}
                        onClick={() => include(p.id)}
                      >
                        {pendingId === p.id ? "Adding…" : "Count this one"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
