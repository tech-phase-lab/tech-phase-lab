import type { Metadata } from "next";
import WatchlistSample from "./sample";

export const metadata: Metadata = { title: "ウォッチリスト表示サンプル | Tech Phase Research", robots: { index: false, follow: false } };
export default function Page() { return <WatchlistSample />; }
