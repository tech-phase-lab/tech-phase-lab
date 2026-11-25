import type { Metadata } from "next";
import type { ReactNode } from "react";

// The page itself is a client component, so its browser-tab title is set here.
export const metadata: Metadata = { title: "ハイテク速報 | Tech Phase Research" };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
