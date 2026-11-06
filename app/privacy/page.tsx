import type { Metadata } from "next";
import LegalScreen, { LegalBody } from "../legal/legal-screen";
import privacy from "@/lib/legal/privacy-ja";
import privacyEn from "@/lib/legal/privacy-en";

// A draft before launch: kept out of search engines.
export const metadata: Metadata = { title: "プライバシーポリシー | Tech Phase", robots: { index: false, follow: false } };
export default function Page() { return <LegalScreen><LegalBody ja={privacy} en={privacyEn} /></LegalScreen>; }
