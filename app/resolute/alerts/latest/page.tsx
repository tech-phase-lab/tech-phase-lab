import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { clerkAppearance } from "@/lib/clerk-appearance";
import { membershipConfigured } from "@/lib/membership/server";
import LatestAlertIdentity from "./identity";
import LatestAlertScreen from "./screen";
export const metadata: Metadata = { title: "RESOLUTE | 今日のお知らせ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
/** The page a RESOLUTE ③ phone notification opens (public/research-sw.js, lib/research/push-targets.json). */
export default function Page() {
  if (!membershipConfigured()) return <LatestAlertScreen />;
  return <ClerkProvider appearance={clerkAppearance} signInUrl="/research/account" signUpUrl="/research/account/sign-up"><LatestAlertIdentity /></ClerkProvider>;
}
