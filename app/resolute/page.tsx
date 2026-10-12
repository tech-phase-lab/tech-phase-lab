import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { membershipConfigured } from "@/lib/membership/server";
import DiagnosisScreen from "./screen";
import ResoluteIdentity from "./identity";
export const metadata: Metadata = { title: "RESOLUTE | Your investing rules", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export default function ResolutePage() {
 if(!membershipConfigured()) return <DiagnosisScreen />;
 return <ClerkProvider signInUrl="/research/account" signUpUrl="/research/account/sign-up"><ResoluteIdentity /></ClerkProvider>;
}
