import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { clerkAppearance } from "@/lib/clerk-appearance";
import { membershipConfigured } from "@/lib/membership/server";
import ResoluteIdentity from "../identity";
import SimulationScreen from "./screen";
export const metadata: Metadata = { title: "RESOLUTE | Simulation", robots: { index:false,follow:false } };
export const dynamic="force-dynamic";
export default function SimulationPage() {
 if(!membershipConfigured())return <SimulationScreen/>;
 return <ClerkProvider appearance={clerkAppearance} signInUrl="/research/account" signUpUrl="/research/account/sign-up"><ResoluteIdentity simulation/></ClerkProvider>;
}
