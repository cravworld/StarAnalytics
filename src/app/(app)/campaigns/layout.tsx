"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isCampaignDetailRoute } from "@/lib/campaignRoutes";

const TABS = [
  { href: "/campaigns", label: "Own Campaigns" },
  { href: "/campaigns/hashtag", label: "Hashtag Search" },
  { href: "/campaigns/agency", label: "Agency Report" },
];

export default function CampaignsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // The tabs persist on any campaign detail view (/campaigns/[id]). In the
  // prototype the .inner-tabs div is a sibling of both #camp-own and the detail
  // panel, and toggling between them never hides the tab bar — "Own Campaigns"
  // stays the active tab on a detail route, which the isDetailRoute check below
  // covers generically instead of special-casing any one campaign's slug.
  //
  // Note TABS is deliberately a subset of the sidebar's nav: not every campaign page
  // gets a tab. The detail check must still consider the FULL subroute list, though —
  // its own local copy omitted /campaigns/keywords, /campaigns/compare-own and
  // /campaigns/comments, so each of those rendered with "Own Campaigns" highlighted and
  // aria-current="page" pointing a screen reader at a page the user was not on.
  const isDetailRoute = isCampaignDetailRoute(pathname);

  return (
    <>
      <nav className="inner-tabs" aria-label="Campaign views">
        {TABS.map((t) => {
          const active = t.href === "/campaigns" ? pathname === t.href || isDetailRoute : pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`itab${active ? " active" : ""}`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </>
  );
}
