import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ClerkProvider } from "@clerk/nextjs";
import { membershipConfigured } from "@/lib/membership/server";
import ReceiveScreen from "./screen";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "RESOLUTE | Receive your purchase", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function ReceivePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams, language = params.lang === "en" ? "en" : "ja";
  if (!membershipConfigured() || process.env.RESOLUTE_PAYPAL_LIVE_ENABLED !== "true" || process.env.RESOLUTE_GUEST_CHECKOUT_ENABLED !== "true")
    return <main><h1>RESOLUTE</h1><p>{language === "en" ? "Purchase activation is currently unavailable. Please try again later." : "現在、購入の受け取りを利用できません。時間をおいて再度お試しください。"}</p></main>;
  const orderId = typeof params.order === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(params.order) ? params.order : null;
  const hasLink = (await cookies()).has("__Host-resolute-recovery");
  return <ClerkProvider><ReceiveScreen orderId={orderId} language={language} hasLink={hasLink} signingUp={params.signup === "1"}/></ClerkProvider>;
}
