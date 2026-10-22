import type { Metadata } from "next";
import Moderation from "./moderation";

// This page is built per request; only the research home is prerendered (owner, Oct 22: faster app open).
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "質問受信箱 | Tech Phase Research", robots: { index: false, follow: false } };
export default function Page() { return <Moderation />; }
