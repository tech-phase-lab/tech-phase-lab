import type { Metadata } from "next";
import HealthScreen from "./screen";

export const metadata: Metadata = { title: "財務健全性マップ | Tech Phase PRO", robots: { index: false, follow: false } };
export default function Page() { return <HealthScreen />; }
