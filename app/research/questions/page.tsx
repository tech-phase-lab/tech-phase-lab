import type { Metadata } from "next";
import Moderation from "./moderation";
import { requireOperatorPage } from "@/lib/membership/operator-page";
export const metadata: Metadata = { title: "質問受信箱 | Tech Phase Research", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export default async function Page() { await requireOperatorPage(); return <Moderation />; }
