import type { Metadata } from "next";
import { providers, sectorNames, sectorNamesEn } from "@/lib/research/intake";
import Watchlist from "./watchlist";

export const metadata: Metadata = { title: "お気に入り銘柄 | Tech Phase Research", robots: { index: false, follow: false } };
export default function WatchlistPage() {
  return <Watchlist companies={providers.map(({ ticker, name, sector }) => ({ ticker, name, sector: { ja: sectorNames[sector], en: sectorNamesEn[sector] } }))} />;
}
