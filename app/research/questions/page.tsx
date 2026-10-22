import type { Metadata } from "next";
import Moderation from "./moderation";
export const metadata: Metadata = { title: "質問受信箱 | Tech Phase Research", robots: { index: false, follow: false } };
export default function Page() { return <Moderation />; }
