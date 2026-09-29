import type { Metadata } from "next";
import type { ReactNode } from "react";
import { MemberDisplayProvider } from "./member-display-provider";
import BottomNav from "./bottom-nav";
import BackToTop from "./back-to-top";
import QuickNote from "./quick-note";
import { getMembership } from "@/lib/membership/server";

export const metadata: Metadata = { appleWebApp: { capable: true, title: "Tech Phase" }, icons: { apple: "/tech-phase-192.png" } };

export default async function ResearchLayout({ children }: { children: ReactNode }) {
  const member = await getMembership().catch(() => null);
  const initial = member && member.status !== "unavailable" ? {
    plan: member.plan,
    owner: member.status === "signed-in" && member.isAdmin,
    ownerMode: member.status === "signed-in" && member.ownerMode,
    accessExpiresAt: member.status === "signed-in" ? member.accessExpiresAt : 0,
  } : undefined;
  return <MemberDisplayProvider initial={initial}>{children}<QuickNote /><BackToTop /><BottomNav /></MemberDisplayProvider>;
}
