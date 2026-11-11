import "server-only";
import { unstable_cache } from "next/cache";
import { calendarEvents, dateOnlyEarnings } from "./calendar";
import { chartSpec, nextEarningsFromSite, parseBars, parseNextEarnings, parseQuote, parseQuotes, parseStatistics, trimBars, type Bar, type ChartRange, type MarketFacts, type MarketQuote } from "./market-quote";

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
    const body = await response.json() as { status?: unknown; code?: unknown; message?: unknown };
    if (body?.status === "error") throw new Error(`twelve-data ${path} ${String(body.code)} ${String(body.message).slice(0, 120)}`);
    return body;
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
export async function loadBars(ticker: string, range: ChartRange, mic?: string): Promise<Bar[]> {
  const memoryKey = `${ticker}${mic ? `@${mic}` : ""}:${range}`, hit = barMemory.get(memoryKey);
  const ttl = chartSpec(range).interval === "1day" || chartSpec(range).interval === "1week" ? 5 * TTL : TTL;
  if (hit && hit.at + ttl > Date.now()) return hit.bars;
  const { interval, size } = chartSpec(range);
  const raw = await call("time_series", { symbol: ticker, interval, outputsize: String(size), order: "desc", ...(mic ? { mic_code: mic } : {}) });
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
  const [stats, earnings] = await Promise.allSettled([call("statistics", { symbol: ticker }), call("earnings", { symbol: ticker, period: "next" })]);
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

/** Owner, Nov 11: the index symbols (DJI / NDX / SPX) answered with other securities on this plan (a $21 and a $0.1 quote), so the
 * panel reads the three ETFs that track them. The percentage is the ETF's and the column says so; never mix in an unchecked symbol. */
export const INDICES = [
  { id: "dow", etf: "DIA", mic: "ARCX", ja: "NYダウ", en: "Dow" },
  { id: "nasdaq100", etf: "QQQ", mic: "XNAS", ja: "NASDAQ100", en: "NASDAQ 100" },
  { id: "sp500", etf: "SPY", mic: "ARCX", ja: "S&P500", en: "S&P 500" },
] as const;
export type IndexQuote = { id: string; ja: string; en: string; value: number; percentChange: number | null; proxy: string; asOf: string; marketOpen: boolean; line: number[] };
export const loadIndices = unstable_cache(async (): Promise<IndexQuote[]> => {
  // Each ETF is read on its own exchange: a bare "SPY" can answer with another listing (owner's design pack, Nov 11).
  const out: IndexQuote[] = [];
  await Promise.all(INDICES.map(async index => {
    try {
      const q = parseQuote(await call("quote", { symbol: index.etf, mic_code: index.mic }), index.etf);
      if (!q) return;
      const bars = await loadBars(index.etf, "1d", index.mic).catch(() => []);
      out.push({ id: index.id, ja: index.ja, en: index.en, value: q.price, percentChange: q.percentChange, proxy: index.etf, asOf: q.asOf, marketOpen: q.marketOpen, line: bars.map(b => b.close) });
    } catch (error) { console.warn(`market indices ${index.etf}: ${error instanceof Error ? error.message : "failed"}`); }
  }));
  return INDICES.flatMap(index => out.filter(item => item.id === index.id));
}, ["market-indices-v3"], { revalidate: 60 });
