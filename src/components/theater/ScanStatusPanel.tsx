import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import type { CampaignDetail } from "@/lib/data/theaterCampaigns";

function when(d: Date | null | undefined): string {
  if (!d) return "–";
  return new Date(d).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Last scan status.
 *
 * Exists mainly to make failure LOUD. The core risk this feature carries is an Apify or
 * BookMyShow failure being read downstream as "demand collapsed everywhere" — so a scan
 * that could not read some cities says so, in numbers, above the table those cities are
 * missing from.
 */
export function ScanStatusPanel({ detail }: { detail: CampaignDetail }) {
  const scan = detail.lastScan;

  if (!scan) {
    return (
      <Card title="Last scan">
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          This campaign has never been scanned. Use <strong>Run scan now</strong> to collect a first reading.
        </div>
      </Card>
    );
  }

  const failed = scan.failedCities;

  return (
    <Card title="Last scan">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", fontSize: 12 }}>
        <StatusPill status={scan.status} />
        {/* Keyed on what produced THIS scan, not on the current env var. Flipping
            DATA_MODE_BOOKMYSHOW to live does not retroactively make yesterday's fixture
            numbers real, and the badge has to keep saying so until a live scan replaces
            them. */}
        {scan.provider === "mock" ? (
          <span title="These figures come from the bundled fixture, not from BookMyShow.">
            <Pill kind="warn">Mock data</Pill>
          </span>
        ) : null}
        <span>
          <span style={{ color: "var(--muted)" }}>Started </span>
          {when(scan.startedAt)}
        </span>
        <span>
          <span style={{ color: "var(--muted)" }}>Finished </span>
          {when(scan.finishedAt)}
        </span>
        <span>
          <span style={{ color: "var(--muted)" }}>City pages read </span>
          {scan.citiesSucceeded} / {scan.citiesRequested}
        </span>
        {scan.recordsSkipped > 0 ? (
          <span title="Rows BookMyShow returned that could not be read — usually a missing show id or an unparseable time. A sudden jump here means BookMyShow changed something.">
            <span style={{ color: "var(--muted)" }}>Rows skipped </span>
            {scan.recordsSkipped}
          </span>
        ) : null}
      </div>

      {scan.recordsUnmapped > 0 ? (
        // The loudest thing on this panel, deliberately. An unrecognised availStatus means
        // the demand vocabulary the whole ranking rests on may no longer match what
        // BookMyShow sends — and because unrecognised readings are excluded from the
        // signal, the symptom is a table that quietly empties rather than an error.
        <div
          role="alert"
          style={{
            marginTop: 10,
            fontSize: 12,
            color: "var(--pencil-red)",
            border: "1px solid rgba(129,0,31,.26)",
            background: "rgba(129,0,31,.07)",
            padding: "8px 10px",
            borderRadius: 3,
          }}
        >
          <strong>{scan.recordsUnmapped} shows returned an availability code we do not recognise.</strong>{" "}
          BookMyShow may have changed how it reports availability. Demand levels and the ranking below may be
          wrong — verify before acting on them.
        </div>
      ) : null}

      {scan.error ? (
        <div role="alert" style={{ marginTop: 10, fontSize: 12, color: "var(--pencil-red)" }}>
          {scan.error}
        </div>
      ) : null}

      {failed.length > 0 ? (
        <div style={{ marginTop: 10, fontSize: 12 }}>
          <div style={{ color: "var(--muted)", marginBottom: 4 }}>
            These cities could not be read. They are shown as <em>not scanned</em>, not as having no demand:
          </div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {failed.map((c) => (
              <li key={`${c.cityCode}-${c.status}`}>
                <strong>{c.cityCode}</strong> — {c.status === "region_mismatch"
                  ? "BookMyShow served a different city's data for this request, so it was discarded."
                  : (c.error ?? "unknown error")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function StatusPill({ status }: { status: string }) {
  if (status === "done") return <Pill kind="good">Completed</Pill>;
  if (status === "partial") return <Pill kind="warn">Completed with gaps</Pill>;
  if (status === "running" || status === "queued") return <Pill kind="live">Running</Pill>;
  return <Pill kind="bad">Failed</Pill>;
}
