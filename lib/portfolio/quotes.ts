import "server-only";
import { unstable_cache } from "next/cache";
import { parseTimeSeries } from "../research/theme-prices.ts";
import type { Quote } from "./calc.ts";

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

async function collect(tickers: string[]): Promise<{ quotes: Record<string, Quote>; usdJpy: number | null; asOf: string | null }> {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error("not-configured");
  const quotes: Record<string, Quote> = {};
  for (let i = 0; i < tickers.length; i += 12) {
    for (const item of await series(tickers.slice(i, i + 12), key)) quotes[item.ticker] = { ticker: item.ticker, close: item.closes[0], asOf: item.asOf };
  }
  let usdJpy: number | null = null;
  try { const fx = (await series(["USD/JPY"], key))[0]; usdJpy = fx && fx.closes[0] > 50 && fx.closes[0] < 400 ? fx.closes[0] : null; } catch { /* the yen value is simply not shown */ }
  const asOf = Object.values(quotes).map(q => q.asOf).sort().at(-1) ?? null;
  return { quotes, usdJpy, asOf };
}

/** Ten-minute cache per ticker set; a failed fetch is never cached. */
export const loadQuotes = (tickers: string[]) => {
  const sorted = [...new Set(tickers)].sort();
  return unstable_cache(() => collect(sorted), ["portfolio-quotes-v1", sorted.join(",")], { revalidate: 600 })();
};
