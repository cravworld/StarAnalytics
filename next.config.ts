import type { NextConfig } from "next";

// StarAnalytics is marked Confidential on every screen — baseline hardening headers
// since there's no CSP/clickjacking protection configured anywhere else in the app.
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // frame-ancestors 'none' covers the same clickjacking case as X-Frame-Options for
  // browsers that honor CSP; kept minimal rather than a full CSP since the app pulls
  // Google's OAuth UI and Supabase Realtime, both of which a strict script-src would break.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
