import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { membershipConfigured } from "@/lib/membership/server";
import { canReviewResolute } from "@/lib/resolute/review-policy";
import { loadThermometerSnapshot } from "@/lib/resolute/thermometer-server";
import HomeScreen from "./home/screen";
import ResoluteIdentity from "./identity";
export const metadata: Metadata = { title: "RESOLUTE | Your investing rules", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export default async function ResolutePage() {
 if(!membershipConfigured()) return <HomeScreen />;
 // The home card uses this shared entry. Only the verified preview owner is
 // routed to the existing sandbox; customer purchase checks stay unchanged.
 let userId: string | null = null;
 try { ({userId} = await auth()); } catch { /* Fail closed to normal access checks. */ }
 if(canReviewResolute(userId,process.env.VERCEL_ENV)) redirect("/resolute/review");
 const snapshot = await loadThermometerSnapshot();
 return <ClerkProvider signInUrl="/research/account" signUpUrl="/research/account/sign-up"><ResoluteIdentity extra="home" thermometerSnapshot={snapshot} /></ClerkProvider>;
}
