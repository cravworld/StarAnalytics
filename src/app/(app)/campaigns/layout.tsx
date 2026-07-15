"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const TABS = [
  { href: "/campaigns", label: "Own Campaigns" },
  { href: "/campaigns/hashtag", label: "Hashtag Search" },
  { href: "/campaigns/agency", label: "Agency Report" },
];

export default function CampaignsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // The tabs persist on the #vijayam detail view. In the prototype the .inner-tabs
  // div is a sibling of both #camp-own and #camp-vijayam, and openVijayam() toggles
  // only those two — so the tab bar never disappears. "Own Campaigns" stays the
  // active tab there, which /campaigns/vijayam satisfies via the startsWith below.
  return (
    <>
      <div className="inner-tabs">
        {TABS.map((t) => {
          // Sub-routes of a tab keep that tab lit; without this, /campaigns/vijayam
          // would render the bar with nothing active.
          const active = t.href === "/campaigns" ? pathname === t.href || pathname.startsWith("/campaigns/vijayam") : pathname === t.href;
          return (
            <Link key={t.href} href={t.href} className={`itab${active ? " active" : ""}`}>
              {t.label}
            </Link>
          );
        })}
      </div>
      {children}
    </>
  );
}
