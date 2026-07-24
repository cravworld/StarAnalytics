// Compact display for large counts (followers, reach, etc.) — "7.4M", "312K" — matching
// the KPI tile style already used across Dashboard/Content/Audience.
export function formatCompactNumber(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
