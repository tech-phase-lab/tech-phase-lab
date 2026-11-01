import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { clerkAppearance } from "@/lib/clerk-appearance";
import { membershipConfigured } from "@/lib/membership/server";
import SettingsScreen from "./screen";
import AuthenticatedSettings from "./identity";

export const metadata: Metadata = { title: "RESOLUTE | Settings", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default function ResoluteSettingsPage() {
  if (!membershipConfigured()) return <SettingsScreen />;
  // Keep Clerk mounted here too so the session cookie can renew outside /research.
  return <ClerkProvider appearance={clerkAppearance} signInUrl="/research/account" signUpUrl="/research/account/sign-up">
    <AuthenticatedSettings />
  </ClerkProvider>;
}
