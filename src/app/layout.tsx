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

export const metadata: Metadata = {
  title: "StarAnalytics — Nivin Pauly",
  description: "Social media intelligence dashboard — Confidential",
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
