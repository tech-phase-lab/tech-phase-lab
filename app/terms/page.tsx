import type { Metadata } from "next";
import LegalDocument from "../legal/legal-document";
import LegalScreen from "../legal/legal-screen";
import terms from "@/lib/legal/terms-ja";

// A draft before launch: kept out of search engines.
export const metadata: Metadata = { title: "利用規約 | Tech Phase", robots: { index: false, follow: false } };
export default function Page() { return <LegalScreen><LegalDocument source={terms} /></LegalScreen>; }
