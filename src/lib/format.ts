// Compact display for large counts (followers, reach, etc.) — "7.4M", "312K" — matching
// the KPI tile style already used across Dashboard/Content/Audience.
export function formatCompactNumber(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

// Coarse "how long ago" for staleness copy — "6 hours ago", "7 days ago". Deliberately
// not a live-updating or minute-precise relative time: this is rendered server-side into
// a banner about data freshness, where a reader needs the order of magnitude, and an
// exact-looking figure would go wrong the moment the page sat open.
export function formatAge(from: Date, now: number = Date.now()): string {
  const minutes = Math.floor((now - from.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
