import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QuoteDetail from "../../price/quote-detail";
import { TICKER_RE } from "@/lib/research/market-quote";
import type { DetailOrigin } from "../../price/quote-card";

export const metadata: Metadata = { title: "銘柄の詳細 | Tech Phase Research", robots: { index: false, follow: false } };
const ORIGINS: DetailOrigin[] = ["watchlist", "watch", "search"];
export default async function QuotePage({ params, searchParams }: { params: Promise<{ ticker: string }>; searchParams: Promise<{ from?: string }> }) {
  const { ticker: raw } = await params, { from } = await searchParams;
  const ticker = decodeURIComponent(raw).toUpperCase();
  if (!TICKER_RE.test(ticker)) notFound();
  return <QuoteDetail ticker={ticker} from={ORIGINS.find(origin => origin === from) ?? "search"} />;
}
