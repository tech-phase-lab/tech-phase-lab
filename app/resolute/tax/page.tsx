import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { membershipConfigured } from "@/lib/membership/server";
import ResoluteIdentity from "../identity";
import TaxScreen from "./screen";
export const metadata:Metadata={title:"RESOLUTE | Tax estimate (Japan)",robots:{index:false,follow:false}};
export const dynamic="force-dynamic";
export default function Page(){
 if(!membershipConfigured())return <TaxScreen/>;
 return <ClerkProvider signInUrl="/research/account" signUpUrl="/research/account/sign-up"><ResoluteIdentity extra="tax"/></ClerkProvider>;
}
