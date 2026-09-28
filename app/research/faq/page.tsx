import type { Metadata } from "next";
import Faq from "./faq";

export const metadata: Metadata = { title: "ご利用ガイド | Tech Phase Research", description: "Tech Phase Researchの表示、会員機能、質問、カレンダー、通知についての無料案内。" };
export default function Page() { return <Faq />; }
