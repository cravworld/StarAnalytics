"use client";

// Deliberately not a server-rendered PDF (no @react-pdf/renderer / headless-browser
// dependency) — the browser's own print-to-PDF does the work. Cheap to build, no
// serverless cold-start cost, no new package. If this ever needs to be emailed
// automatically (e.g. as part of a scheduled digest), that's the point to revisit and
// bring in real server-side PDF rendering — a manual one-off export doesn't need it.
export function MediaKitPrintButton() {
  return (
    <button className="tb-btn primary no-print" onClick={() => window.print()}>
      Export as PDF
    </button>
  );
}
