import type { ScoutRawRow } from "@/lib/data/scout";

const COLS: { key: keyof ScoutRawRow; label: string }[] = [
  { key: "handle", label: "Handle" },
  { key: "suppliedName", label: "Name" },
  { key: "deliverable", label: "Deliverable" },
  { key: "buzzFactor", label: "Buzz" },
  { key: "followers", label: "Followers" },
  { key: "engagementRatePct", label: "Eng. rate %" },
  { key: "commentRatePct", label: "Comment rate %" },
  { key: "consistencyScore", label: "Consistency" },
  { key: "postingFrequencyPerWeek", label: "Posts/week" },
  { key: "contentMixClipsPct", label: "Clips %" },
  { key: "contentMixCarouselPct", label: "Carousel %" },
  { key: "contentMixImagePct", label: "Image %" },
  { key: "postsAnalyzed", label: "Posts analyzed" },
  { key: "note", label: "Note" },
];

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "–";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
}

export function ScoutDataTable({ rows }: { rows: ScoutRawRow[] }) {
  return (
    <div className="card" style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            {COLS.map((c) => (
              <th
                key={c.key}
                style={{ textAlign: "left", padding: "6px 10px", borderBottom: "1px solid var(--border)", color: "var(--muted)", whiteSpace: "nowrap" }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.handle}>
              {COLS.map((c) => (
                <td key={c.key} style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>
                  {c.key === "handle" ? (
                    <a href={`https://www.instagram.com/${r.handle}/`} target="_blank" rel="noreferrer">
                      @{r.handle}
                    </a>
                  ) : (
                    fmt(r[c.key])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
