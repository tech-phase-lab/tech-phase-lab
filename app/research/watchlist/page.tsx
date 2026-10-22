import type { Metadata } from "next";
import { providers, sectorNames, sectorNamesEn } from "@/lib/research/intake";
import Watchlist from "./watchlist";


// This page is built per request; only the research home is prerendered (owner, Oct 22: faster app open).
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ウォッチリスト | Tech Phase Research", robots: { index: false, follow: false } };
export default function WatchlistPage() {
  return <Watchlist companies={providers.map(({ ticker, name, sector }) => ({ ticker, name, sector: { ja: sectorNames[sector], en: sectorNamesEn[sector] } }))} />;
}
