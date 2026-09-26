import type { Metadata } from "next";
import StockDirectory from "./stock-directory";

export const metadata: Metadata = {
  title: "米国株検索 | Tech Phase Research",
  description: "SECの公式企業・ティッカー・取引所対応表から米国上場銘柄を検索するプレビュー。",
  robots: { index: false, follow: false },
};

export default function StockDirectoryPage() {
  return <StockDirectory />;
}
