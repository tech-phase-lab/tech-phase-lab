import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QuoteDetail from "../../../price/quote-detail";

export const metadata: Metadata = { title: "指数 | Tech Phase Research", robots: { index: false, follow: false } };
/** The full-screen page of one index: the same build as the stock detail, without the company tabs and the star. The price is that of the tracking ETF. */
const INDEXES: Record<string, { symbol: string; title: string }> = {
  dow: { symbol: "DIA", title: "NYダウ" }, nasdaq100: { symbol: "QQQ", title: "NASDAQ100" }, sp500: { symbol: "SPY", title: "S&P500" },
};
export default async function IndexPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params, index = INDEXES[id];
  if (!index) notFound();
  return <QuoteDetail ticker={index.symbol} from="market" title={index.title} plain />;
}
