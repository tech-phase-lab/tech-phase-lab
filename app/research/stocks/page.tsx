import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import StockDirectory from "./stock-directory";
import ResearchLoading from "../loading";
import { providers, sectorNames, sectorNamesEn } from "@/lib/research/intake";

/** The roster's sectors, the watchlist's registered tags (watchlist/page.tsx), for the result cards. */
const sectors = Object.fromEntries(providers.map(({ ticker, sector }) => [ticker, { ja: sectorNames[sector], en: sectorNamesEn[sector] }]));

export const metadata: Metadata = {
  title: "米国株検索 | Tech Phase Research",
  description: "SECの公式企業・ティッカー・取引所対応表から米国上場銘柄を検索するプレビュー。",
  robots: { index: false, follow: false },
};

export default async function StockDirectoryPage() {
  // Rendered per request so the search page (and ?q=) is in the first HTML: as a prerendered page, useSearchParams made the whole page
  // render in the browser behind the full-screen loading mark, which then gave way to the page (owner, Nov 18: pages opening in steps).
  await connection();
  return <Suspense fallback={<ResearchLoading />}><StockDirectory sectors={sectors} /></Suspense>;
}
