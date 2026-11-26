import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import StockDirectory from "./stock-directory";
import ResearchLoading from "../loading";
import { providers, sectorNames, sectorNamesEn } from "@/lib/research/intake";
import { loadFocusView, type FocusView } from "@/lib/research/search-focus-server";

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
  // 「今日の注目」 and the theme rows' day change come with the page (owner, Nov 26: the first screen at once): the shared snapshot only,
  // never the provider (lib/research/search-focus-server.ts). A slow store never holds the page: the screen then shows no figures.
  const focus = await Promise.race([loadFocusView().catch(() => null), new Promise<FocusView | null>(resolve => setTimeout(() => resolve(null), 1_200))]);
  return <Suspense fallback={<ResearchLoading />}><StockDirectory sectors={sectors} focus={focus} /></Suspense>;
}
