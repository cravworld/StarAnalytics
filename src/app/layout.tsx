import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// next/font self-hosts the file and emits a size-adjusted local fallback, so the
// swap from fallback to Inter causes no layout shift (CLS). The previous
// system-stack-only setup rendered a different face on every OS — Segoe UI on
// Windows, SF on macOS — which meant the dense 10-11px labels that carry most of
// this dashboard's information were never tuned against a known metric.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  // Consumed by `body { font-family: var(--font-sans, …) }` in globals.css, which
  // keeps the system stack as a real fallback rather than a hardcoded assumption.
  variable: "--font-sans",
});

// VERCEL_URL is set automatically per-deployment (preview and production alike) — using it
// rather than a hardcoded domain means metadataBase (needed to resolve the icon/OG image
// file conventions below into absolute URLs) is always correct without a manual update on
// every new deployment URL. Falls back to production's known domain for local dev, where
// VERCEL_URL isn't set at all.
const siteUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://staranalytics.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "StarAnalytics — Nivin Pauly",
  description: "Social media intelligence dashboard — Confidential",
  // Deliberately generic (app name + category description only) rather than naming the
  // client/actor this deployment is for — unlike the in-app sidebar, this metadata renders
  // in link-preview cards (Slack, WhatsApp, iMessage, etc.) to anyone who sees a shared URL,
  // signed in or not, so it shouldn't say more than the page's own <title> already does.
  openGraph: {
    title: "StarAnalytics",
    description: "Social media intelligence dashboard",
    siteName: "StarAnalytics",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "StarAnalytics",
    description: "Social media intelligence dashboard",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
