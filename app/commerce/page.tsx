import type { Metadata } from "next";
import LegalScreen, { LegalBody } from "../legal/legal-screen";
import commerce from "@/lib/legal/commerce-ja";
import commerceEn from "@/lib/legal/commerce-en";

// 特定商取引法に基づく表記 (Tech Phase Research and RESOLUTE). Public, no sign-in; kept out of search engines like the terms.
export const metadata: Metadata = { title: "特定商取引法に基づく表記 | Tech Phase", robots: { index: false, follow: false } };
export default function Page() { return <LegalScreen><LegalBody ja={commerce} en={commerceEn} /></LegalScreen>; }
