import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono, Caveat } from "next/font/google";
import "./globals.css";

// next/font self-hosts each file and emits a size-adjusted local fallback, so the
// swap from fallback to the real face causes no layout shift (CLS).
//
// Three families where there was one, which is a real cost (~+100KB of woff2) paid
// deliberately: the label voice and the data voice have to be visibly different for
// the notebook language to work at all, and a numerals face was the whole point of
// dropping the system stack in the first place.

// The data voice. Lining tabular figures, an unambiguous 1/l/7, and a slashed zero
// available via the `zero` feature — every metric in this app is set in it.
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  display: "swap",
  // Consumed by `body { font-family: var(--font-sans, …) }` in globals.css, which
  // keeps the system stack as a real fallback rather than a hardcoded assumption.
  variable: "--font-sans",
});

// The label voice. Shares its skeleton and metrics with Plex Sans, so a KPI label
// and the number beneath it read as one voice at two registers rather than as two
// unrelated typefaces. Google ships no variable cut, so the weights this app
// actually uses are pinned explicitly — omitting them pulls all seven.
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "600"],
  variable: "--font-mono",
});

// The hand. Deliberately the outsider: it is the only face here that is not part of
// the Plex superfamily, and it is capped at two instances per screen and never set
// below 15px. See the honesty rule in globals.css — it annotates, it never asserts.
const caveat = Caveat({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-hand",
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
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} ${caveat.variable}`}>
      <body>{children}</body>
    </html>
  );
}
