"use client";

import { useState } from "react";

// Both views render server-side (passed in as children) — this just shows/hides, no
// re-fetch. "Leaderboard" is the visual read; "Data Table" is every raw field, for anyone
// who wants to look at the actual numbers rather than the score.
export function ScoutViewToggle({ leaderboard, table }: { leaderboard: React.ReactNode; table: React.ReactNode }) {
  const [view, setView] = useState<"leaderboard" | "table">("leaderboard");

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          className={`btn ${view === "leaderboard" ? "btn-primary" : ""}`}
          onClick={() => setView("leaderboard")}
        >
          Leaderboard
        </button>
        <button className={`btn ${view === "table" ? "btn-primary" : ""}`} onClick={() => setView("table")}>
          Data Table
        </button>
      </div>
      {view === "leaderboard" ? leaderboard : table}
    </>
  );
}
