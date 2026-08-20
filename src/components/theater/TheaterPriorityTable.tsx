"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ConfidencePill, PriorityPill } from "./DemandPill";
import type { TheaterRow } from "@/lib/data/theaterCampaigns";

// Client component because the filters are interactive. The rows themselves are computed
// on the server — this only ever narrows and sorts what it was handed, it never derives a
// metric of its own.

const TH: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 10px",
  borderBottom: "1px solid var(--border)",
  color: "var(--muted)",
  whiteSpace: "nowrap",
};
const TD: React.CSSProperties = {
  padding: "6px 10px",
  borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap",
  verticalAlign: "top",
};

function hoursUntilLabel(d: Date | null): string {
  if (!d) return "–";
  const hours = (new Date(d).getTime() - Date.now()) / 3_600_000;
  if (hours < 0) return "started";
  if (hours < 1) return "<1h";
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function showTime(d: Date | null): string {
  if (!d) return "–";
  return new Date(d).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TheaterPriorityTable({
  campaignId,
  rows,
}: {
  campaignId: string;
  rows: TheaterRow[];
}) {
  const [city, setCity] = useState("");
  const [band, setBand] = useState("");
  const [confidence, setConfidence] = useState("");
  const [format, setFormat] = useState("");
  const [language, setLanguage] = useState("");
  const [query, setQuery] = useState("");

  const cities = useMemo(
    () => [...new Set(rows.map((r) => r.cityName))].sort(),
    [rows],
  );
  const formats = useMemo(() => [...new Set(rows.flatMap((r) => r.formats))].sort(), [rows]);
  const languages = useMemo(() => [...new Set(rows.flatMap((r) => r.languages))].sort(), [rows]);

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (city && r.cityName !== city) return false;
        if (band && r.priority.band !== band) return false;
        if (confidence && r.priority.confidence !== confidence) return false;
        if (format && !r.formats.includes(format)) return false;
        if (language && !r.languages.includes(language)) return false;
        if (query && !r.name.toLowerCase().includes(query.toLowerCase())) return false;
        return true;
      }),
    [rows, city, band, confidence, format, language, query],
  );

  if (rows.length === 0) {
    return (
      <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 2px" }}>
        No BookMyShow showtimes have been stored for this campaign yet. If a scan has run and this is still
        empty, the film may not be listed in the selected cities for the dates scanned — check the scan status
        above before assuming there is no audience.
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12, fontSize: 12 }}>
        <input
          aria-label="Filter by theater name"
          placeholder="Theater name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ padding: "4px 8px", minWidth: 160 }}
        />
        <Select label="City" value={city} onChange={setCity} options={cities} />
        <Select
          label="Priority"
          value={band}
          onChange={setBand}
          options={["high", "medium", "low", "not_ranked"]}
          render={(v) =>
            v === "high" ? "Push here" : v === "medium" ? "Watch" : v === "low" ? "Healthy" : "Not enough data"
          }
        />
        <Select label="Confidence" value={confidence} onChange={setConfidence} options={["high", "low", "none"]} />
        {formats.length > 0 ? <Select label="Format" value={format} onChange={setFormat} options={formats} /> : null}
        {languages.length > 0 ? (
          <Select label="Language" value={language} onChange={setLanguage} options={languages} />
        ) : null}
        <span style={{ alignSelf: "center", color: "var(--muted)" }}>
          {filtered.length} of {rows.length} theaters
        </span>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={TH}>Priority</th>
              <th style={TH}>Theater</th>
              <th style={TH}>City</th>
              <th style={TH}>Next show</th>
              <th style={TH}>In</th>
              <th style={TH} title="Shows with a usable demand reading. Not a seat count.">
                Shows
              </th>
              <th style={TH} title="Shows BookMyShow still reports as having plenty of seats on sale.">
                Wide open
              </th>
              <th style={TH} title="Net movement in demand level since this theater was first observed. Not seats, and not sales.">
                Movement
              </th>
              <th style={TH}>Price bands</th>
              <th style={TH}>Confidence</th>
              <th style={TH}>Last seen</th>
              <th style={TH}>Recommendation</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.theaterId}>
                <td style={TD}>
                  <PriorityPill band={r.priority.band} />
                  {r.priority.band !== "not_ranked" ? (
                    <div style={{ color: "var(--muted)", fontSize: 10, marginTop: 2 }}>{r.priority.score}</div>
                  ) : null}
                </td>
                <td style={{ ...TD, whiteSpace: "normal", minWidth: 180 }}>
                  <Link href={`/theater-campaigns/${campaignId}/theaters/${r.theaterId}`}>{r.name}</Link>
                  <div style={{ color: "var(--muted)", fontSize: 10 }}>{r.venueCode}</div>
                </td>
                <td style={TD}>{r.cityName}</td>
                <td style={TD}>{showTime(r.nextShowAt)}</td>
                <td style={TD}>{hoursUntilLabel(r.nextShowAt)}</td>
                <td style={TD}>{r.priority.eligibleShows}</td>
                <td style={TD}>
                  {r.priority.wideOpenShows}
                  {r.priority.eligibleShows > 0 ? (
                    <span style={{ color: "var(--muted)" }}>
                      {" "}
                      ({Math.round((r.priority.wideOpenShows / r.priority.eligibleShows) * 100)}%)
                    </span>
                  ) : null}
                </td>
                <td style={TD}>
                  {r.priority.movement === null ? (
                    <span style={{ color: "var(--muted)" }} title="Only one observation so far — not enough to say.">
                      not yet
                    </span>
                  ) : r.priority.movement > 0 ? (
                    `+${r.priority.movement}`
                  ) : (
                    "none"
                  )}
                </td>
                <td style={TD}>{r.priceBands.length > 0 ? r.priceBands.join(", ") : "–"}</td>
                <td style={TD}>
                  <ConfidencePill confidence={r.priority.confidence} />
                </td>
                <td style={TD}>{showTime(r.lastScannedAt)}</td>
                <td style={{ ...TD, whiteSpace: "normal", minWidth: 220 }}>
                  {r.priority.recommendation}
                  <ul style={{ margin: "4px 0 0", paddingLeft: 16, color: "var(--muted)" }}>
                    {r.priority.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  render,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  render?: (v: string) => string;
}) {
  return (
    <label style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ padding: "4px 6px" }}>
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {render ? render(o) : o}
          </option>
        ))}
      </select>
    </label>
  );
}
