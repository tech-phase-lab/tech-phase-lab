import "server-only";
import { unstable_cache } from "next/cache";
import { calendarEvents, dateOnlyEarnings } from "./calendar";
import { chartSpec, nextEarningsFromSite, parseBars, parseNextEarnings, parseQuotes, parseStatistics, trimBars, type Bar, type ChartRange, type MarketFacts, type MarketQuote } from "./market-quote";

/** Server-side Twelve Data reads for the price screens. The key (TWELVE_DATA_API_KEY) never leaves the server. */
const BASE = () => process.env.TWELVE_DATA_BASE_URL || "https://api.twelvedata.com";
export const marketDataConfigured = () => !!process.env.TWELVE_DATA_API_KEY;
const TTL = 60_000;

async function call(path: string, params: Record<string, string>): Promise<unknown> {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error("not-configured");
  const url = new URL(`${BASE()}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("apikey", key);
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
    if (response.status === 429 && attempt < 2) { await new Promise(r => setTimeout(r, 4000 * (attempt + 1))); continue; }
    if (!response.ok) throw new Error(`twelve-data ${path} ${response.status}`);
    return response.json();
  }
  throw new Error(`twelve-data ${path} rate-limited`);
}

// One-minute memory cache per ticker (and in-flight sharing), so a busy minute costs each symbol one request.
const quoteMemory = new Map<string, { at: number; quote: MarketQuote | null }>();
const pending = new Map<string, Promise<void>>();
export async function loadMarketQuotes(tickers: string[]): Promise<Record<string, MarketQuote>> {
  const wanted = [...new Set(tickers)];
  const stale = wanted.filter(t => (quoteMemory.get(t)?.at ?? 0) + TTL < Date.now());
  for (let i = 0; i < stale.length; i += 12) {
    const group = stale.slice(i, i + 12), id = group.join(",");
    let job = pending.get(id);
    if (!job) {
      job = call("quote", { symbol: id }).then(raw => {
        const parsed = parseQuotes(raw, group);
        for (const t of group) quoteMemory.set(t, { at: Date.now(), quote: parsed[t] ?? null });
      }).finally(() => pending.delete(id));
      pending.set(id, job);
    }
    try { await job; } catch (error) { console.warn(`market quotes ${id}: ${error instanceof Error ? error.message : "failed"}`); }
  }
  const out: Record<string, MarketQuote> = {};
  for (const t of wanted) { const hit = quoteMemory.get(t)?.quote; if (hit) out[t] = hit; }
  return out;
}

const barMemory = new Map<string, { at: number; bars: Bar[] }>();
export async function loadBars(ticker: string, range: ChartRange): Promise<Bar[]> {
  const memoryKey = `${ticker}:${range}`, hit = barMemory.get(memoryKey);
  const ttl = chartSpec(range).interval === "1day" || chartSpec(range).interval === "1week" ? 5 * TTL : TTL;
  if (hit && hit.at + ttl > Date.now()) return hit.bars;
  const { interval, size } = chartSpec(range);
  const raw = await call("time_series", { symbol: ticker, interval, outputsize: String(size), order: "desc" });
  const bars = trimBars(parseBars(raw), range);
  barMemory.set(memoryKey, { at: Date.now(), bars });
  return bars;
}
/** Intraday closes of several tickers for the watchlist sparklines (last session only). */
export async function loadIntraday(tickers: string[]): Promise<Record<string, Bar[]>> {
  const out: Record<string, Bar[]> = {};
  await Promise.all(tickers.map(async t => { try { out[t] = await loadBars(t, "1d"); } catch { out[t] = []; } }));
  return out;
}

const facts = (ticker: string) => unstable_cache(async (): Promise<MarketFacts> => {
  const [stats, earnings] = await Promise.allSettled([call("statistics", { symbol: ticker }), call("earnings", { symbol: ticker, outputsize: "6" })]);
  const parsed = stats.status === "fulfilled" ? parseStatistics(stats.value, ticker) : null;
  const today = new Date().toISOString().slice(0, 10);
  const own = nextEarningsFromSite(ticker, [...calendarEvents, ...dateOnlyEarnings], today);
  const provider = earnings.status === "fulfilled" ? parseNextEarnings(earnings.value, today) : null;
  if (!parsed && stats.status === "rejected" && earnings.status === "rejected") throw new Error("facts-unavailable");
  return { eps: parsed?.eps ?? null, marketCap: parsed?.marketCap ?? null, dividendYield: parsed?.dividendYield ?? null, nextEarnings: own ?? provider };
}, ["market-facts-v1", ticker], { revalidate: 6 * 3600 })();
/** EPS, market cap, dividend yield and the next earnings date. The site's own calendar wins over the provider's. A failed read is never cached. */
export async function loadMarketFacts(ticker: string): Promise<MarketFacts> {
  try { return await facts(ticker); } catch { return { eps: null, marketCap: null, dividendYield: null, nextEarnings: nextEarningsFromSite(ticker, [...calendarEvents, ...dateOnlyEarnings], new Date().toISOString().slice(0, 10)) }; }
}

export const INDICES = [
  { id: "dow", symbol: "DJI", etf: "DIA", ja: "NYダウ", en: "Dow" },
  { id: "nasdaq100", symbol: "NDX", etf: "QQQ", ja: "NASDAQ100", en: "NASDAQ 100" },
  { id: "sp500", symbol: "SPX", etf: "SPY", ja: "S&P500", en: "S&P 500" },
] as const;
export type IndexQuote = { id: string; ja: string; en: string; value: number; percentChange: number | null; proxy: string | null; asOf: string; marketOpen: boolean; line: number[] };
/** The three indices; a symbol the plan does not serve falls back to its ETF (the percentage then describes the ETF). */
export const loadIndices = unstable_cache(async (): Promise<IndexQuote[]> => {
  const direct = await loadMarketQuotes(INDICES.map(i => i.symbol)).catch(() => ({}) as Record<string, MarketQuote>);
  const missing = INDICES.filter(i => !direct[i.symbol]);
  const proxies = missing.length ? await loadMarketQuotes(missing.map(i => i.etf)).catch(() => ({}) as Record<string, MarketQuote>) : {};
  const out: IndexQuote[] = [];
  for (const index of INDICES) {
    const proxy = !direct[index.symbol], q = direct[index.symbol] ?? proxies[index.etf];
    if (!q) continue;
    const bars = await loadBars(proxy ? index.etf : index.symbol, "1d").catch(() => []);
    out.push({ id: index.id, ja: index.ja, en: index.en, value: q.price, percentChange: q.percentChange, proxy: proxy ? index.etf : null, asOf: q.asOf, marketOpen: q.marketOpen, line: bars.map(b => b.close) });
  }
  return out;
}, ["market-indices-v1"], { revalidate: 60 });
