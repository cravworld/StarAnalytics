import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
