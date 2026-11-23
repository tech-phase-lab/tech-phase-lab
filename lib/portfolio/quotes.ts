import "server-only";
import { parseTimeSeries } from "../research/theme-prices.ts";
import type { Quote } from "./calc.ts";
import { createBatcher } from "./quote-batcher.ts";
import { providerLimited, reserveCredits, sharedReader } from "../research/twelve-gateway";
import type { ReadSpec } from "../research/twelve-budget.ts";

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
  await reserveCredits(symbols.length); // one credit per symbol, inside the site's share of the plan's minute
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (response.status === 429) providerLimited();
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

/** Ten-minute copy per ticker, shared by every reader and instance whatever else they hold (lib/research/twelve-budget.ts); a symbol the
 * provider does not know is kept as null. A read the plan's minute has no room for (or that fails) shows the last good close, with its own
 * date, for up to a week (owner, Nov 23); only a ticker never read before fails the answer. */
const PORTFOLIO: ReadSpec = { name: "portfolio-quote-v2", slotMs: 600_000, staleMs: 7 * 86_400_000 };
async function oneQuote(ticker: string) {
  const got = await sharedReader.read<Quote | null>(PORTFOLIO, ticker, () => fetchQuote(ticker));
  if (!got) throw new Error("unavailable");
  return got;
}

async function loadUsdJpy(): Promise<number | null> {
  const got = await sharedReader.read<number>(PORTFOLIO, "USD/JPY", async () => {
    const key = process.env.TWELVE_DATA_API_KEY;
    if (!key) throw new Error("not-configured");
    const fx = (await series(["USD/JPY"], key))[0];
    if (!fx || !(fx.closes[0] > 50 && fx.closes[0] < 400)) throw new Error("fx-unusable");
    return fx.closes[0];
  });
  return got?.value ?? null; // the yen value is simply not shown
}

/** Latest closes per ticker plus USD/JPY; `stale` lists the tickers shown with an earlier close (each quote keeps its own `asOf`). A symbol
 * with no data is simply absent; the answer fails only when a ticker has never been read and cannot be read now. */
export async function loadQuotes(tickers: string[]): Promise<{ quotes: Record<string, Quote>; usdJpy: number | null; asOf: string | null; stale: string[] }> {
  if (!process.env.TWELVE_DATA_API_KEY) throw new Error("not-configured");
  const sorted = [...new Set(tickers)].sort();
  const [found, usdJpy] = await Promise.all([Promise.all(sorted.map(oneQuote)), loadUsdJpy().catch(() => null)]);
  const quotes: Record<string, Quote> = {}, stale: string[] = [];
  found.forEach((got, index) => { if (got.value) { quotes[sorted[index]] = got.value; if (!got.fresh) stale.push(sorted[index]); } });
  const asOf = Object.values(quotes).map(q => q.asOf).sort().at(-1) ?? null;
  return { quotes, usdJpy, asOf, stale };
}
