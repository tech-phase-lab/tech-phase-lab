import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { sandboxTester } from "@/lib/resolute/sandbox-access";
import { membershipConfigured } from "@/lib/membership/server";
import CheckoutIdentity from "./identity";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "RESOLUTE | Sandbox checkout", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function CheckoutPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
 const params = await searchParams;
 const language = params.lang === "en" ? "en" : "ja";
 const order = typeof params.order === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.order) ? params.order : null;
 if (!membershipConfigured()) return <main><h1>RESOLUTE</h1><p>{language === "en" ? "Test checkout is unavailable." : "テスト購入は現在利用できません。"}</p></main>;
 const { userId } = await auth();
 const authorizedTester = process.env.VERCEL_ENV === "preview" && userId === sandboxTester(process.env) ? userId : null;
 return <ClerkProvider signInUrl="/resolute/checkout" signUpUrl="/research/account/sign-up">
  <CheckoutIdentity orderId={order} language={language} cancelled={params.cancel === "1"} authorizedTester={authorizedTester}/>
 </ClerkProvider>;
}
