import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { membershipConfigured } from "@/lib/membership/server";
import ResoluteIdentity from "../identity";
import NotificationScreen from "../notifications-screen";
export const metadata:Metadata={title:"RESOLUTE | Alerts",robots:{index:false,follow:false}};
export const dynamic="force-dynamic";
export default function Page(){
 if(!membershipConfigured())return <NotificationScreen mode="alerts"/>;
 return <ClerkProvider signInUrl="/research/account" signUpUrl="/research/account/sign-up"><ResoluteIdentity notification="alerts"/></ClerkProvider>;
}
