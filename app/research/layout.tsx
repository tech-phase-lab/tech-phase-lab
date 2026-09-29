import type { Metadata } from "next";
import type { ReactNode } from "react";
import { MemberDisplayProvider } from "./member-display-provider";
import BottomNav from "./bottom-nav";
import BackToTop from "./back-to-top";
import QuickNote from "./quick-note";

export const metadata: Metadata = { appleWebApp: { capable: true, title: "Tech Phase" }, icons: { apple: "/tech-phase-192.png" } };

export default function ResearchLayout({ children }: { children: ReactNode }) {
  return <MemberDisplayProvider>{children}<QuickNote /><BackToTop /><BottomNav /></MemberDisplayProvider>;
}
