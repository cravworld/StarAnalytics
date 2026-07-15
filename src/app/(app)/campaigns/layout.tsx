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
  const showTabs = pathname !== "/campaigns/vijayam";

  return (
    <>
      {showTabs ? (
        <div className="inner-tabs">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} className={`itab${pathname === t.href ? " active" : ""}`}>
              {t.label}
            </Link>
          ))}
        </div>
      ) : null}
      {children}
    </>
  );
}
