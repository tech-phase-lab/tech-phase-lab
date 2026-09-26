import type { Metadata } from "next";
import type { ReactNode } from "react";
import BackToTop from "./back-to-top";

export const metadata: Metadata = { appleWebApp: { capable: true, title: "Tech Phase" }, icons: { apple: "/tech-phase-192.png" } };

export default function ResearchLayout({ children }: { children: ReactNode }) {
  return <>{children}<BackToTop /></>;
}
