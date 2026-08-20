// Compact display for large counts (followers, reach, etc.) — "7.4M", "312K" — matching
// the KPI tile style already used across Dashboard/Content/Audience.
export function formatCompactNumber(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

/**
 * Date-time for display, pinned to India.
 *
 * `toLocaleString(undefined, …)` takes the locale AND time zone from whatever runtime it
 * happens to execute in. Server-rendered that is the Vercel function (UTC); re-rendered
 * during hydration it is the visitor's browser (IST here). The two produce different text
 * for the same instant, which React reports as hydration error #418 and which briefly shows
 * a showtime five and a half hours wrong.
 *
 * Pinning is not a workaround for the mismatch, it is the correct display rule: every date
 * on these screens is an Indian cinema showtime or a scan of one, and IST is the only zone
 * in which those read correctly. An operator in another zone should still see the show as
 * the audience will.
 */
export function formatIstDateTime(d: Date | string | number): string {
  return new Date(d).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

/**
 * Coarse "time until" for an upcoming show.
 *
 * `now` is injectable for the same reason `formatAge` takes it: read from `Date.now()` at
 * render, the server and the client compute it milliseconds apart, and a value sitting near
 * a boundary renders "1h" on one side and "<1h" on the other — a hydration mismatch that
 * appears only sometimes, which is the worst kind.
 */
export function formatHoursUntil(d: Date | string | null | undefined, now: number): string {
  if (!d) return "–";
  const hours = (new Date(d).getTime() - now) / 3_600_000;
  if (hours < 0) return "started";
  if (hours < 1) return "<1h";
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
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
