"use client";

import type { Flag } from "@/lib/scoring/types";

// Evidence drill-down — the Authenticity Audit's whole reason for existing is
// that a flag has to survive a dispute. Rendering the raw evidence object
// (not just the flag's name) is the point; a placeholder here would defeat it.
function humanizeKey(key: string): string {
  const spaced = key.replace(/([A-Z])/g, " $1");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(" – ");
  if (value === null || value === undefined) return "—";
  return String(value);
}

const SEVERITY_LABEL: Record<Flag["severity"], string> = { high: "High", medium: "Medium", low: "Low" };

export function FlagEvidencePanel({ flag, onClose }: { flag: Flag; onClose: () => void }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ maxWidth: 420, width: "90%", maxHeight: "80vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div>
            <div className="card-title" style={{ marginBottom: 4 }}>
              Evidence
            </div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>
              {flag.type.replace(/_/g, " ")} · <span style={{ color: "var(--muted)" }}>{SEVERITY_LABEL[flag.severity]}</span>
            </div>
          </div>
          <button className="back-link" onClick={onClose} style={{ marginBottom: 0 }}>
            ✕ Close
          </button>
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.9 }}>
          {Object.entries(flag.evidence).map(([key, value]) => (
            <div
              key={key}
              style={{ display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "1px solid var(--border)" }}
            >
              <span style={{ color: "var(--muted)" }}>{humanizeKey(key)}</span>
              <span style={{ fontWeight: 600, textAlign: "right" }}>{formatValue(value)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
