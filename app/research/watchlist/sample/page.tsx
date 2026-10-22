import type { Metadata } from "next";
import WatchlistSample from "./sample";


// This page is built per request; only the research home is prerendered (owner, Oct 22: faster app open).
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ウォッチリスト表示サンプル | Tech Phase Research", robots: { index: false, follow: false } };
export default function Page() { return <WatchlistSample />; }
