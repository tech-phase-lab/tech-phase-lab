import type { Metadata } from "next";
import LegalScreen, { LegalBody } from "../legal/legal-screen";
import terms from "@/lib/legal/terms-ja";
import termsEn from "@/lib/legal/terms-en";

// A draft before launch: kept out of search engines.
export const metadata: Metadata = { title: "利用規約 | Tech Phase", robots: { index: false, follow: false } };
export default function Page() { return <LegalScreen><LegalBody ja={terms} en={termsEn} /></LegalScreen>; }
