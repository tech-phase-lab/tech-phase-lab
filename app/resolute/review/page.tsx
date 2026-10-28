import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { membershipConfigured } from "@/lib/membership/server";
import { loadThermometerSnapshot } from "@/lib/resolute/thermometer-server";
import ReviewIdentity from "./identity";
import ReviewScreen from "./screen";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title:"RESOLUTE | Owner review", robots:{index:false,follow:false} };
export default async function ReviewPage() {
 if (!membershipConfigured()) return <ReviewScreen/>;
 const snapshot = await loadThermometerSnapshot();
 return <ClerkProvider signInUrl="/resolute/review" signUpUrl="/research/account/sign-up"><ReviewIdentity thermometerSnapshot={snapshot}/></ClerkProvider>;
}
