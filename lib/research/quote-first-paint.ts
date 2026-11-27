import "server-only";
import { isMarketChartSymbol, marketDataConfigured, peekPeriodSet, peekQuote } from "./market-data";
import { directoryTickers, marketCaller } from "./market-access";
import { tickerAllowed } from "./market-guard";
import { quoteAnswer, type Bar } from "./market-quote";
import type { BoardPeriod } from "./market-board-periods";

/** What a stock page (/research/quote/[ticker]) draws into its first HTML (speed, Nov 26): the quote and the default period's chart from the
 * shared copies, never the provider (a page view spends nothing; the page's own reads, which may, follow as before). The same symbols rule
 * as the public price routes: a visitor who is not signed in only for the site's lists and listed companies (lib/research/market-guard.ts). */
export type FirstQuote = { quotes: Record<string, unknown>; at: number; chart: { period: BoardPeriod; bars: Bar[]; before: Bar[] } | null };

async function load(ticker: string, period: BoardPeriod): Promise<FirstQuote | null> {
  if (!marketDataConfigured()) return null;
  const caller = await marketCaller();
  const list = caller === "anonymous" ? await directoryTickers() : null;
  if (!tickerAllowed(ticker, caller, "light", list, isMarketChartSymbol)) return null;
  const [quote, chart] = await Promise.all([peekQuote(ticker), peekPeriodSet(ticker, period).catch(() => null)]);
  if (!quote) return null;
  return { quotes: quoteAnswer({ [ticker]: quote }), at: Date.now(), chart: chart && { period, ...chart } };
}

/** At most this long; without an answer the page opens as before. */
export function firstQuoteWithin(ticker: string, period: BoardPeriod, wait = 600): Promise<FirstQuote | null> {
  return Promise.race([load(ticker, period).catch(() => null), new Promise<null>(resolve => setTimeout(() => resolve(null), wait))]);
}
