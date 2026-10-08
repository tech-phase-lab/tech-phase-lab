import { initialMemberDisplay } from "@/lib/membership/display-server";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { MemberDisplayProvider } from "./member-display-provider";
import LaunchBrand from "./launch-brand";
import BottomNav from "./bottom-nav";
import PullToRefresh from "./pull-to-refresh";
import BackToTop from "./back-to-top";
import ResearchIdentityProvider from "./identity-provider";
import { membershipConfigured } from "@/lib/membership/server";

// Protected APIs verify membership independently; the public shell must not wait for a remote user lookup.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { appleWebApp: { capable: true, title: "Tech Phase" }, icons: { apple: "/tech-phase-192.png" } };

export default async function ResearchLayout({ children }: { children: ReactNode }) {
  const initial = await initialMemberDisplay();
  return <><LaunchBrand /><ResearchIdentityProvider enabled={membershipConfigured()}><MemberDisplayProvider initial={initial}>{children}<PullToRefresh /><BackToTop /><BottomNav /></MemberDisplayProvider></ResearchIdentityProvider></>;
}
