"use client";

import { useMemo } from "react";
import { useTopbarExport } from "./TopbarExportContext";
import { toCsv } from "@/lib/csv";

// Lets a pure server-component page register a CSV export without being converted to a
// client component itself — the page fetches its data server-side as usual and passes the
// already-computed headers/rows in as plain props (safe to cross the RSC boundary: data
// only, no functions — see the media-kit feature's note on why `format` functions can't).
//
// The `useMemo` here mirrors OwnCampaignsList.tsx's exact pattern for a real reason, not
// just style: a fresh { filename, csv } object passed to useTopbarExport on every render
// re-fires its effect every render, which re-renders the shared TopbarExportProvider, which
// re-renders this component — a confirmed infinite-render-loop bug the first time this
// mechanism was wired up (see that file's comment). rows/headers are stable server-provided
// props for the lifetime of one server render, so memoizing against them is correct, not
// just cautious.
export function CsvExportRegistrar({
  filename,
  headers,
  rows,
}: {
  filename: string;
  headers: string[];
  rows: (string | number)[][];
}) {
  const config = useMemo(() => ({ filename, csv: () => toCsv(headers, rows) }), [filename, headers, rows]);
  useTopbarExport(config);
  return null;
}
