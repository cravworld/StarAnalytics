"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addTrackedPostsAction } from "@/lib/actions/trackedPosts";
import { parsePostUrl, splitTrackedPostUrls, TRACK_SUBMIT_CHUNK_SIZE } from "@/lib/tracking/postUrl";
import type { IngestOutcome, IngestResult } from "@/lib/data/trackedPosts";

/**
 * Paste post links to track them.
 *
 * Accepts several links at once even though the brief was "I will feed links manually" —
 * the ingest function has always taken an array (so bulk upload stays a parser rather than
 * a second pipeline), and a textarea costs nothing over a single input while letting
 * someone paste a column straight out of a sheet.
 *
 * **It submits one link per request, not the whole box.** Sending the lot in a single
 * Server Action was what it did originally, on the strength of MAX_URLS_PER_SUBMIT being
 * "matched to the scrape batch size so one submission is at most one actor run". That is
 * true of the post-metrics actor and false in aggregate: storeTrackedPost calls
 * refreshAccountSnapshotIfStale for every post, which runs a live Apify profile scrape for
 * each account the tracker hasn't seen recently, serially, inside the request. A paste of
 * links from a dozen different influencers is a dozen sequential actor runs in one POST,
 * which is a 504 — and, because the whole IngestResult was thrown away with the error, an
 * operator with no way to tell which of their links had actually landed before the cutoff.
 *
 * So: same shape as BulkAddFanPagesForm, and for the same reason.
 *  - Chunked, so no single request can outrun the page's maxDuration.
 *  - Outcomes accumulate per chunk, so a timeout or a closed tab keeps everything already
 *    stored and still names it. Nothing here is all-or-nothing.
 *  - Stoppable, because realising you pasted the wrong column happens five links in.
 *  - Three failures in a row aborts: one bad link is routine, three straight means the
 *    session expired or Apify is refusing, and the rest of the list would fail identically.
 */

/** @see CONSECUTIVE_FAILURE_LIMIT in BulkAddFanPagesForm — same reasoning, same number. */
const CONSECUTIVE_FAILURE_LIMIT = 3;

const EMPTY_RESULT: IngestResult = {
  added: 0,
  duplicates: 0,
  rejected: 0,
  pageSubscriptionIds: [],
  outcomes: [],
};

/**
 * In-paste duplicates, resolved here rather than by the server.
 *
 * The server still dedups by postKey, but it can only see one chunk at a time now, so the
 * second copy of a link would reach it as a fresh submission and come back as "already
 * tracked in this campaign" — technically true, quietly misleading, and a wasted round trip
 * against a real scraper. parsePostUrl is deliberately dependency-free (see its header) so
 * the same keying is available here for free.
 *
 * Links that don't parse as posts are passed through untouched: they may be page/profile
 * links, and only the server knows how to tell those from junk.
 */
function splitPasteForSubmit(raw: string): { submit: string[]; duplicates: IngestOutcome[] } {
  const submit: string[] = [];
  const duplicates: IngestOutcome[] = [];
  const seen = new Set<string>();
  for (const url of splitTrackedPostUrls(raw)) {
    const parsed = parsePostUrl(url);
    if (!parsed.ok) {
      submit.push(url);
      continue;
    }
    const key = `${parsed.value.platform}:${parsed.value.postKey}`;
    if (seen.has(key)) {
      duplicates.push({ url, status: "duplicate", reason: "Same post appears twice in this batch." });
      continue;
    }
    seen.add(key);
    submit.push(url);
  }
  return { submit, duplicates };
}

export function AddTrackedPostForm({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [result, setResult] = useState<IngestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // A ref, not state: the loop below reads this between chunks and would close over a stale
  // copy of a state variable for its whole run.
  const stopRequested = useRef(false);

  const pending = progress !== null;
  const parsed = useMemo(() => splitPasteForSubmit(text), [text]);

  async function onSubmit() {
    if (parsed.submit.length === 0) return;
    stopRequested.current = false;
    setError(null);

    // The in-paste duplicates are known before anything is spent, so they seed the running
    // tally rather than being appended at the end — they belong in the first render of it.
    const running: IngestResult = {
      ...EMPTY_RESULT,
      duplicates: parsed.duplicates.length,
      outcomes: [...parsed.duplicates],
    };
    setResult({ ...running, outcomes: [...running.outcomes] });

    const urls = parsed.submit;
    const total = urls.length;
    let consecutiveFailures = 0;
    let stopped = false;
    setProgress({ done: 0, total });

    try {
      for (let i = 0; i < total; i += TRACK_SUBMIT_CHUNK_SIZE) {
        if (stopRequested.current) {
          stopped = true;
          break;
        }
        const chunk = urls.slice(i, i + TRACK_SUBMIT_CHUNK_SIZE);
        setProgress({ done: i, total });

        // Per chunk, NOT around the loop. ingestTrackedPostUrls already turns per-link
        // problems into outcomes, but the call itself still throws for things it never
        // sees — a request over maxDuration, a dropped connection, an expired session.
        // Caught around the loop, any one of those abandoned every link after it.
        try {
          const r = await addTrackedPostsAction(campaignId, chunk.join("\n"));
          running.added += r.added;
          running.duplicates += r.duplicates;
          running.rejected += r.rejected;
          running.pageSubscriptionIds.push(...r.pageSubscriptionIds);
          running.outcomes.push(...r.outcomes);
          consecutiveFailures = 0;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          running.rejected += chunk.length;
          for (const url of chunk) running.outcomes.push({ url, status: "rejected", reason: message });
          if (++consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
            stopped = true;
            setError(
              `Stopped after ${CONSECUTIVE_FAILURE_LIMIT} failures in a row — the remaining links were not attempted. Everything above this point was saved.`,
            );
            setResult({ ...running, outcomes: [...running.outcomes] });
            break;
          }
        }
        // Committed after every chunk rather than at the end, so a run that is stopped or
        // that dies mid-way still shows exactly what it managed to do.
        setResult({ ...running, outcomes: [...running.outcomes] });
      }

      // Only clear the box when everything landed and nothing was left unattempted —
      // otherwise the operator loses the links they still need to fix or re-run.
      if (!stopped && running.rejected === 0 && running.duplicates === 0) setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      // Every exit path: links that succeeded are in the database regardless of how the run
      // ended, so the view below must always end up showing them.
      router.refresh();
      setProgress(null);
    }
  }

  const subscribed = result?.outcomes.filter((o) => o.status === "page-subscribed") ?? [];
  const pagesSubscribed = subscribed.length;
  // "page-subscribed" is a success, not a problem — it must not land in the red list below.
  const problems = result?.outcomes.filter((o) => o.status !== "added" && o.status !== "page-subscribed") ?? [];

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title">Track a post or a page</div>
      <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 8, lineHeight: 1.55 }}>
        Paste Instagram, Facebook or YouTube links — one per line. Mix platforms freely.
        <br />
        A <strong>post link</strong> tracks that post. A <strong>page or profile link</strong>{" "}
        tracks the whole account: their existing posts are pulled in now, and anything they
        post from here on is picked up automatically.
      </div>
      <textarea
        rows={3}
        placeholder={
          "https://www.instagram.com/p/CxYz123/\nhttps://www.instagram.com/theinfluencer/\nhttps://youtu.be/dQw4w9WgXcQ"
        }
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={pending}
        style={{ width: "100%", marginBottom: 8 }}
      />

      {/* Said before the button is pressed, while it is still free to change the paste: a long
          list is a long wait, and someone who doesn't expect that reads it as a hang. */}
      {parsed.submit.length > 1 ? (
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8, lineHeight: 1.5 }}>
          {parsed.submit.length} links
          {parsed.duplicates.length > 0
            ? ` · ${parsed.duplicates.length} repeat${parsed.duplicates.length === 1 ? "" : "s"} skipped`
            : ""}
          . Each one is fetched on its own — a link from an account that&apos;s new to the
          tracker also pulls that account&apos;s follower count, which is slow. Results appear
          as they land, and you can leave it running.
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={onSubmit} disabled={pending || parsed.submit.length === 0}>
          {pending
            ? progress.total > 1
              ? `Fetching ${progress.done + 1} of ${progress.total}…`
              : "Fetching metrics…"
            : "Track posts"}
        </button>
        {pending && progress.total > 1 ? (
          <button className="btn" onClick={() => (stopRequested.current = true)}>
            Stop
          </button>
        ) : null}
        {result ? (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {result.added} post{result.added === 1 ? "" : "s"} added
            {pagesSubscribed > 0 ? `, ${pagesSubscribed} page${pagesSubscribed === 1 ? "" : "s"} tracked` : ""}
            {result.duplicates > 0 ? `, ${result.duplicates} already tracked` : ""}
            {result.rejected > 0 ? `, ${result.rejected} rejected` : ""}
          </span>
        ) : null}
      </div>

      {error ? (
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--pencil-red)" }}>{error}</div>
      ) : null}

      {/* Subscribing is instant; the page's posts are scraped off-request and land shortly
          after. Said explicitly, because otherwise "1 page tracked" with no posts on screen
          reads as a failure. */}
      {subscribed.length > 0 ? (
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--pencil-green)", lineHeight: 1.5 }}>
          {subscribed.map((s, i) => (
            <div key={i}>{s.reason}</div>
          ))}
          <div style={{ color: "var(--muted)", marginTop: 4 }}>
            Their posts are being fetched in the background — reload in a minute to see them.
            Posts mentioning a campaign hashtag are counted automatically; anything else is
            listed under the page as &ldquo;not counted&rdquo; for you to include.
          </div>
        </div>
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
