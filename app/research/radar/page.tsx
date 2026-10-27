import type { Metadata } from "next";
import RadarScreen from "./screen";

export const metadata: Metadata = { title: "財務レーダー | Tech Phase", robots: { index: false, follow: false } };
export default function Page() { return <RadarScreen />; }
