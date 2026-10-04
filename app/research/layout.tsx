import type { Metadata } from "next";
import type { ReactNode } from "react";
import { MemberDisplayProvider } from "./member-display-provider";
import LaunchBrand from "./launch-brand";
import BottomNav from "./bottom-nav";
import BackToTop from "./back-to-top";
import ResearchIdentityProvider from "./identity-provider";
import { membershipConfigured } from "@/lib/membership/server";

// Protected APIs verify membership independently; the public shell must not wait for a remote user lookup.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { appleWebApp: { capable: true, title: "Tech Phase" }, icons: { apple: "/tech-phase-192.png" } };

export default function ResearchLayout({ children }: { children: ReactNode }) {
  return <ResearchIdentityProvider enabled={membershipConfigured()}><MemberDisplayProvider><LaunchBrand />{children}<BackToTop /><BottomNav /></MemberDisplayProvider></ResearchIdentityProvider>;
}
