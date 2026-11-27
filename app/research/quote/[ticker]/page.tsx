import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QuoteDetail from "../../price/quote-detail";
import { TICKER_RE } from "@/lib/research/market-quote";
import type { DetailOrigin } from "../../price/quote-card";
import { firstQuoteWithin } from "@/lib/research/quote-first-paint";

export const metadata: Metadata = { title: "銘柄の詳細 | Tech Phase Research", robots: { index: false, follow: false } };
const ORIGINS: DetailOrigin[] = ["watchlist", "watch", "search"];
export default async function QuotePage({ params, searchParams }: { params: Promise<{ ticker: string }>; searchParams: Promise<{ from?: string }> }) {
  const { ticker: raw } = await params, { from } = await searchParams;
  const ticker = decodeURIComponent(raw).toUpperCase();
  if (!TICKER_RE.test(ticker)) notFound();
  // Speed, Nov 26: the quote and the first chart from the shared copies (lib/research/quote-first-paint.ts); the page refreshes them as before.
  // "15m": the page's default period (DETAIL_DEFAULT_PERIOD in period-buttons.tsx, a client module; a test keeps them equal).
  const initial = await firstQuoteWithin(ticker, "15m");
  return <QuoteDetail ticker={ticker} from={ORIGINS.find(origin => origin === from) ?? "search"} initial={initial} />;
}
