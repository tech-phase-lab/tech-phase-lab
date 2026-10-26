import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { membershipConfigured } from "@/lib/membership/server";
import ResoluteIdentity from "../identity";
import { loadThermometerSnapshot } from "@/lib/resolute/thermometer-server";
import ThermometerScreen from "./screen";
export const metadata:Metadata={title:"RESOLUTE | Market gauge",robots:{index:false,follow:false}};
export const dynamic="force-dynamic";
export default async function Page(){
 const snapshot = await loadThermometerSnapshot();
 if(!membershipConfigured())return <ThermometerScreen snapshot={snapshot}/>;
 return <ClerkProvider signInUrl="/research/account" signUpUrl="/research/account/sign-up"><ResoluteIdentity extra="thermometer" thermometerSnapshot={snapshot}/></ClerkProvider>;
}
