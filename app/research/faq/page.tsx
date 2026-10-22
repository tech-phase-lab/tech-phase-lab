import type { Metadata } from "next";
import Faq from "./faq";


// This page is built per request; only the research home is prerendered (owner, Oct 22: faster app open).
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "よくある質問・使い方 | Tech Phase Research", description: "Tech Phase Researchの利用方法、PRO会員、質問についてのよくある質問。" };
export default function Page() { return <Faq />; }
