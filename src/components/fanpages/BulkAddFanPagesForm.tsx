"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { addFanPagesBulkAction } from "@/lib/actions/fanpages";
import { BULK_ADD_CHUNK_SIZE, parseHandleList } from "@/lib/providers/handle-input";
import type { PlatformId } from "@/lib/providers/types";

interface Progress {
  done: number;
  total: number;
  current: string;
}

interface Tally {
  added: number;
  reactivated: number;
  alreadyTracked: number;
  posts: number;
  failures: { handle: string; error: string }[];
  stopped: boolean;
}

const EMPTY_TALLY: Tally = { added: 0, reactivated: 0, alreadyTracked: 0, posts: 0, failures: [], stopped: false };

const PLACEHOLDERS: Record<PlatformId, string> = {
  instagram: "@fanpage_one\n@fanpage_two\nhttps://instagram.com/fanpage_three\nfanpage_four, fanpage_five",
  youtube: "@channel_one\nhttps://youtube.com/@channel_two\nyoutube.com/c/ChannelThree",
};

/**
 * Paste a whole list of fan pages and add them in one go.
 *
 * The single-handle form above stays as-is — it is the right shape for adding one page you just
 * heard about. This one exists because onboarding a real fan network means twenty or thirty
 * handles arriving as a list, and doing that through a one-line input is a long, error-prone
 * afternoon.
 *
 * Each page gets exactly the pull the single-add button gives it — profile, recent posts and
 * comments — because "the same thing, in bulk" is the whole requirement. Where a page came from
 * must not be visible in the data it ends up with.
 *
 * Three things drive the design, all consequences of each handle being a real, slow scrape:
 *
 * 1. **It says what it parsed before it starts.** The counts under the box update as you type,
 *    using the same parser the server uses, so "24 pages · 2 duplicates removed · 1 line not
 *    recognised" is visible while it is still free to fix.
 * 2. **It submits in chunks and reports progress per handle.** A Server Action is bounded by
 *    the page's maxDuration and one Instagram handle can take ~600s of it, so the list is
 *    chunked at BULK_ADD_CHUNK_SIZE and the results accumulate as they land. A failure or a
 *    closed tab halfway through keeps every page added so far — nothing is all-or-nothing.
 * 3. **It can be stopped.** Twenty minutes into a long run is exactly when someone realises
 *    they pasted the wrong column. Stop takes effect after the chunk in flight, since an Apify
 *    run already started cannot be un-started.
 */
export function BulkAddFanPagesForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<PlatformId>("instagram");
  const [text, setText] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [tally, setTally] = useState<Tally | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A ref, not state: the loop below reads this between chunks and would close over a stale
  // copy of a state variable for its whole run.
  const stopRequested = useRef(false);

  const parsed = useMemo(() => parseHandleList(text, platform), [text, platform]);
  const pending = progress !== null;

  async function onAddAll() {
    if (parsed.handles.length === 0) return;
    stopRequested.current = false;
    setError(null);
    setTally(null);

    const chunkSize = BULK_ADD_CHUNK_SIZE[platform];
    const running: Tally = { ...EMPTY_TALLY, failures: [] };
    const total = parsed.handles.length;
    setProgress({ done: 0, total, current: parsed.handles[0] });

    try {
      for (let i = 0; i < total; i += chunkSize) {
        if (stopRequested.current) {
          running.stopped = true;
          break;
        }
        const chunk = parsed.handles.slice(i, i + chunkSize);
        setProgress({ done: i, total, current: chunk.join(", ") });
        // Revalidate on the final chunk only — see the note on addFanPagesBulkAction. Mid-run
        // revalidation makes every chunk's response carry a re-render of this whole route, which
        // is both wasted database work and a commit into the tree holding this component's state.
        const isFinalChunk = i + chunkSize >= total;
        const outcome = await addFanPagesBulkAction(chunk, platform, isFinalChunk);
        running.added += outcome.added;
        running.reactivated += outcome.reactivated;
        running.alreadyTracked += outcome.alreadyTracked;
        running.posts += outcome.posts;
        running.failures.push(...outcome.failures);
        // Committed after every chunk rather than at the end, so a run that is stopped or that
        // dies mid-way still shows what it managed to do.
        setTally({ ...running, failures: [...running.failures] });
      }
      // Handles that succeeded are already in the database whether or not the rest ran, so the
      // list is refreshed on the way out of every exit path, including the stopped one.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      router.refresh();
    } finally {
      setProgress(null);
    }
  }

  if (!open) {
    return (
      <div style={{ marginTop: -8, marginBottom: 16 }}>
        <button className="btn" style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => setOpen(true)}>
          ＋ Add many at once
        </button>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="card-title">Add many fan pages</div>
        <button className="btn" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => setOpen(false)} disabled={pending}>
          Close
        </button>
      </div>

      <div style={{ fontSize: 11, color: "var(--muted)", margin: "6px 0 8px" }}>
        One per line, or separated by commas. Handles, @handles and profile URLs all work.
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value as PlatformId)}
          disabled={pending}
          style={{ width: 110 }}
        >
          <option value="instagram">Instagram</option>
          <option value="youtube">YouTube</option>
        </select>
        <div style={{ fontSize: 11, color: "var(--muted)", alignSelf: "center" }}>
          One platform per paste — add the other platform&apos;s pages as a second batch.
        </div>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={pending}
        placeholder={PLACEHOLDERS[platform]}
        rows={8}
        style={{ width: "100%", fontFamily: "inherit", fontSize: 12, resize: "vertical" }}
      />

      {/* The pre-flight readout. Deliberately shown before anything is spent, because every one
          of these numbers is a decision the user can still change for free. */}
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
        {parsed.handles.length} page{parsed.handles.length === 1 ? "" : "s"} ready
        {parsed.duplicates > 0 ? ` · ${parsed.duplicates} duplicate${parsed.duplicates === 1 ? "" : "s"} removed` : ""}
        {parsed.invalid.length > 0 ? (
          <span style={{ color: "var(--pencil-amber)" }}>
            {" "}
            · {parsed.invalid.length} line{parsed.invalid.length === 1 ? "" : "s"} not recognised:{" "}
            {parsed.invalid.slice(0, 5).join(", ")}
            {parsed.invalid.length > 5 ? ` +${parsed.invalid.length - 5} more` : ""}
          </span>
        ) : null}
      </div>

      {platform === "instagram" && parsed.handles.length > 0 ? (
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
          Each page gets the same full pull as adding it by hand — profile, 50 recent posts and
          comments — so this runs one page at a time and takes about as long as {parsed.handles.length}{" "}
          individual add{parsed.handles.length === 1 ? "" : "s"}. You can leave it running.
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
        <button className="btn btn-primary" onClick={onAddAll} disabled={pending || parsed.handles.length === 0}>
          {pending
            ? `Adding ${progress.done + 1} of ${progress.total}…`
            : `＋ Add ${parsed.handles.length} page${parsed.handles.length === 1 ? "" : "s"}`}
        </button>
        {pending ? (
          <button className="btn" onClick={() => (stopRequested.current = true)}>
            Stop
          </button>
        ) : null}
        {pending ? (
          <span style={{ fontSize: 11, color: "var(--muted)" }}>{progress.current}</span>
        ) : null}
      </div>

      {/* The finished state was 11px muted text tucked under the button — the same weight as the
          hint above it, and easy to miss entirely after a run long enough to walk away from.
          A run that spends real time and money has to end in something you cannot scroll past,
          so the outcome gets a bordered panel and the headline number gets full contrast. */}
      {tally ? (
        <div
          style={{
            marginTop: 10,
            padding: "8px 10px",
            border: "1px solid var(--border)",
            borderLeft: `3px solid ${tally.failures.length > 0 ? "var(--pencil-amber)" : "var(--green, var(--muted))"}`,
            borderRadius: 4,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            {pending
              ? `Adding… ${tally.added} of ${progress.total} done`
              : tally.stopped
                ? `Stopped — added ${tally.added} page${tally.added === 1 ? "" : "s"}`
                : `Done — added ${tally.added} page${tally.added === 1 ? "" : "s"}`}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
            {tally.posts} posts stored
            {tally.reactivated > 0 ? ` · ${tally.reactivated} re-activated` : ""}
            {tally.alreadyTracked > 0 ? ` · ${tally.alreadyTracked} already tracked` : ""}
            {tally.failures.length > 0 ? ` · ${tally.failures.length} failed` : ""}
          </div>
          {tally.failures.length > 0 ? (
            <div style={{ fontSize: 11, color: "var(--pencil-amber)", marginTop: 6 }}>
              {tally.failures.map((f) => (
                <div key={f.handle}>
                  @{f.handle}: {f.error}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? <div style={{ color: "var(--pencil-red)", fontSize: 11, marginTop: 6 }}>{error}</div> : null}
    </div>
  );
}
