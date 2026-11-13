import "server-only";
import { unstable_cache } from "next/cache";
import { parseTimeSeries } from "../research/theme-prices.ts";
import type { Quote } from "./calc.ts";
import { createBatcher } from "./quote-batcher.ts";

/** Latest closing prices and the USD/JPY rate for the portfolio. Twelve Data key stays in the environment; nothing is invented without it. */
const BASE = () => process.env.TWELVE_DATA_BASE_URL || "https://api.twelvedata.com";
export const quotesConfigured = () => !!process.env.TWELVE_DATA_API_KEY;
export const TICKER_PATTERN = /^[A-Z][A-Z0-9.\-]{0,9}$/;

async function series(symbols: string[], key: string) {
  const url = new URL(`${BASE()}/time_series`);
  url.searchParams.set("symbol", symbols.join(","));
  url.searchParams.set("interval", "1day");
  url.searchParams.set("outputsize", "3");
  url.searchParams.set("apikey", key);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Twelve Data ${response.status}`);
  const body = await response.json() as Record<string, unknown>;
  // A single symbol comes back unwrapped; wrap it so one parser handles both.
  return parseTimeSeries(symbols.length === 1 && body && typeof body === "object" && "values" in body ? { [symbols[0]]: body } : body, symbols);
}

const readMany = async (tickers: string[]): Promise<Map<string, Quote>> => {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error("not-configured");
  return new Map((await series(tickers, key)).map(item => [item.ticker, { ticker: item.ticker, close: item.closes[0], asOf: item.asOf }]));
};
// Only tickers that missed the cache reach this; the ones that miss together go out as one request.
const fetchQuote = createBatcher<Quote>(readMany);

/** Ten-minute cache per ticker, shared by every reader whatever else they hold; a failed fetch is never cached (a symbol the provider
 * does not know is cached as null, as the whole answer used to be). */
const oneQuote = (ticker: string) => unstable_cache(async (): Promise<Quote | null> => fetchQuote(ticker), ["portfolio-quote-v1", ticker], { revalidate: 600 })();

const loadUsdJpy = () => unstable_cache(async (): Promise<number> => {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error("not-configured");
  const fx = (await series(["USD/JPY"], key))[0];
  if (!fx || !(fx.closes[0] > 50 && fx.closes[0] < 400)) throw new Error("fx-unusable");
  return fx.closes[0];
}, ["portfolio-usdjpy-v1"], { revalidate: 600 })();

/** Latest closes per ticker plus USD/JPY. One failed read fails the answer, as before; a symbol with no data is simply absent. */
export async function loadQuotes(tickers: string[]): Promise<{ quotes: Record<string, Quote>; usdJpy: number | null; asOf: string | null }> {
  if (!process.env.TWELVE_DATA_API_KEY) throw new Error("not-configured");
  const sorted = [...new Set(tickers)].sort();
  const [found, usdJpy] = await Promise.all([
    Promise.all(sorted.map(oneQuote)),
    loadUsdJpy().catch(() => null), // the yen value is simply not shown
  ]);
  const quotes: Record<string, Quote> = {};
  found.forEach((quote, index) => { if (quote) quotes[sorted[index]] = quote; });
  const asOf = Object.values(quotes).map(q => q.asOf).sort().at(-1) ?? null;
  return { quotes, usdJpy, asOf };
}
