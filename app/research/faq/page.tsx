import type { Metadata } from "next";
import Faq from "./faq";

export const metadata: Metadata = { title: "よくある質問・使い方 | Tech Phase Research", description: "Tech Phase Researchの利用方法、PRO会員、質問についてのよくある質問。" };
export default function Page() { return <Faq />; }
