import type { Metadata } from "next";
import type { ReactNode } from "react";
import { MemberDisplayProvider } from "./member-display-provider";
import AccountReturnTracker from "./account-return-tracker";
import LaunchBrand from "./launch-brand";
import BottomNav from "./bottom-nav";
import PullToRefresh from "./pull-to-refresh";
import BackToTop from "./back-to-top";
import ResearchIdentityProvider from "./identity-provider";
import { membershipConfigured } from "@/lib/membership/server";
import { memberHintBoot } from "@/lib/research/member-hint-boot";

// Protected APIs verify membership independently; the public shell must not wait for a remote user lookup.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { appleWebApp: { capable: true, title: "Tech Phase" }, icons: { apple: "/tech-phase-192.png" } };

// The shell does no identity lookup before it streams: the member badge is settled by the client check
// (which never shows FREE before it answers), so opening the app does not wait on the identity service (owner, Oct 21).
export default function ResearchLayout({ children }: { children: ReactNode }) {
  return <><script dangerouslySetInnerHTML={{ __html: memberHintBoot }} /><LaunchBrand /><AccountReturnTracker /><ResearchIdentityProvider enabled={membershipConfigured()}><MemberDisplayProvider>{children}<PullToRefresh /><BackToTop /><BottomNav /></MemberDisplayProvider></ResearchIdentityProvider></>;
}
