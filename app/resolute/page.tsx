import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { membershipConfigured } from "@/lib/membership/server";
import { canReviewResolute } from "@/lib/resolute/review-policy";
import { loadThermometerSnapshot } from "@/lib/resolute/thermometer-server";
import HomeScreen from "./home/screen";
import ResoluteIdentity from "./identity";
import EntryGate from "./entry-gate";
import Landing from "./lp/landing";
import LandingEn from "./lp/landing-en";
export const metadata: Metadata = { title: "RESOLUTE | Your investing rules", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export default async function ResolutePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
 if(!membershipConfigured()) return <HomeScreen />;
 // The home card uses this shared entry. Only the verified preview owner is
 // routed to the existing sandbox; customer purchase checks stay unchanged.
 let userId: string | null = null;
 try { ({userId} = await auth()); } catch { /* Fail closed to normal access checks. */ }
 if(canReviewResolute(userId,process.env.VERCEL_ENV)) redirect("/resolute/review");
 const snapshot = await loadThermometerSnapshot();
 // Purchasers go to the home, everyone else sees the landing page (decided on the device; see EntryGate).
 // `?lang=en` shows the English page; everything else the Japanese one.
 const english = (await searchParams).lang === "en";
 return <EntryGate landing={english ? <LandingEn embedded /> : <Landing embedded />}>
  <ClerkProvider signInUrl="/research/account" signUpUrl="/research/account/sign-up"><ResoluteIdentity extra="home" thermometerSnapshot={snapshot} /></ClerkProvider>
 </EntryGate>;
}
