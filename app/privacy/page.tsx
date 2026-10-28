import type { Metadata } from "next";
import LegalDocument from "../legal/legal-document";
import LegalScreen from "../legal/legal-screen";
import privacy from "@/lib/legal/privacy-ja";

// A draft before launch: kept out of search engines.
export const metadata: Metadata = { title: "プライバシーポリシー | Tech Phase", robots: { index: false, follow: false } };
export default function Page() { return <LegalScreen><LegalDocument source={privacy} /></LegalScreen>; }
