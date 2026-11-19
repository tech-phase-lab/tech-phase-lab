import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import StockDirectory from "./stock-directory";
import ResearchLoading from "../loading";

export const metadata: Metadata = {
  title: "米国株検索 | Tech Phase Research",
  description: "SECの公式企業・ティッカー・取引所対応表から米国上場銘柄を検索するプレビュー。",
  robots: { index: false, follow: false },
};

export default async function StockDirectoryPage() {
  // Rendered per request so the search page (and ?q=) is in the first HTML: as a prerendered page, useSearchParams made the whole page
  // render in the browser behind the full-screen loading mark, which then gave way to the page (owner, Nov 18: pages opening in steps).
  await connection();
  return <Suspense fallback={<ResearchLoading />}><StockDirectory /></Suspense>;
}
