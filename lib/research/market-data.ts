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
      job = call("quote", { symbol: id, prepost: "true" }).then(raw => {
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

type Variant = Record<string, string>;
/** What the market page charts besides stocks. Every entry lists the ways to ask the provider for it, tried in turn: an index symbol
 * such as SPX is also the ticker of an ordinary stock, so the quote's NAME is checked (`name`) before a way is trusted; an ETF can
 * trade on several venues. A symbol with no accepted way is simply not shown (and the reason goes to the log). */
type Market = { variants: readonly Variant[]; name?: RegExp; fallback?: string };
const etf = (...mics: string[]): Variant[] => [...mics.map(mic_code => ({ mic_code })), {}];
export const MARKET_SYMBOLS: Record<string, Market> = {
  SPX: { variants: [{ symbol: "SPX", type: "Index" }, { symbol: "SPX", exchange: "INDEX" }, { symbol: "SPX", type: "index" }, { symbol: "GSPC" }], name: /s&p\s*500/i, fallback: "SPY" },
  NDX: { variants: [{ symbol: "NDX", type: "Index" }, { symbol: "NDX", exchange: "INDEX" }, { symbol: "NDX", type: "index" }], name: /nasdaq[\s-]*100/i, fallback: "QQQ" },
  DJI: { variants: [{ symbol: "DJI", type: "Index" }, { symbol: "DJI", exchange: "INDEX" }, { symbol: "DJI", type: "index" }, { symbol: "DJIA" }], name: /dow\s*jones/i, fallback: "DIA" },
  SPY: { variants: etf("ARCX") }, QQQ: { variants: etf("XNMS", "XNGS", "XNAS") }, DIA: { variants: etf("ARCX") },
  SHY: { variants: etf("XNMS", "XNAS", "XNGS") }, IEF: { variants: etf("XNMS", "XNAS", "XNGS") }, TLT: { variants: etf("XNMS", "XNAS", "XNGS") },
  "USD/JPY": { variants: [{}] }, "EUR/USD": { variants: [{}] }, "EUR/JPY": { variants: [{}] },
};
export const isMarketChartSymbol = (symbol: string) => Object.hasOwn(MARKET_SYMBOLS, symbol);

const resolved = new Map<string, { variant: Variant; at: number } | null>();
/** The first way of asking that answers with the right instrument (cached for an hour, a refusal for five minutes so a bad key does not burn credits). */
async function resolveMarket(id: string): Promise<{ symbol: string; extra: Variant; quote: MarketQuote | null }> {
  const entry = MARKET_SYMBOLS[id];
  const hit = resolved.get(id);
  if (hit === null) throw new Error(`unresolved ${id}`);
  const tried: string[] = [];
  const order = hit ? [hit.variant, ...entry.variants.filter(v => v !== hit.variant)] : entry.variants;
  for (const variant of order) {
    const { symbol = id, ...extra } = variant;
    try {
      const quote = parseQuote(await call("quote", { symbol, ...extra, prepost: "true" }), symbol);
      if (!quote) throw new Error("no quote");
      if (entry.name && !entry.name.test(quote.name)) throw new Error(`other instrument "${quote.name}"`);
      resolved.set(id, { variant, at: Date.now() });
      return { symbol, extra, quote };
    } catch (error) { tried.push(`${JSON.stringify(variant)}: ${error instanceof Error ? error.message : "failed"}`); }
  }
  console.warn(`market symbol ${id} could not be resolved. ${tried.join(" | ")}`);
  resolved.set(id, null); setTimeout(() => resolved.delete(id), 5 * 60_000);
  throw new Error(`unresolved ${id}`);
}

const barMemory = new Map<string, { at: number; bars: Bar[] }>();
export async function loadBars(ticker: string, range: ChartRange): Promise<Bar[]> {
  const memoryKey = `${ticker}:${range}`, hit = barMemory.get(memoryKey);
  const spec = chartSpec(range), intraday = spec.interval === "5min" || spec.interval === "30min";
  if (hit && hit.at + (intraday ? TTL : 5 * TTL) > Date.now()) return hit.bars;
  const entry = MARKET_SYMBOLS[ticker];
  let raw: unknown;
  if (entry) {
    let target: { symbol: string; extra: Variant };
    try { target = await resolveMarket(ticker); }
    catch (error) { if (!entry.fallback) throw error; target = await resolveMarket(entry.fallback); }
    raw = await call("time_series", { symbol: target.symbol, interval: spec.interval, outputsize: String(spec.size), order: "desc", ...target.extra, ...(intraday ? { prepost: "true" } : {}) });
  } else raw = await call("time_series", { symbol: ticker, interval: spec.interval, outputsize: String(spec.size), order: "desc", ...(intraday ? { prepost: "true" } : {}) });
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
  { id: "dow", key: "DJI", ja: "NYダウ", en: "Dow" },
  { id: "nasdaq100", key: "NDX", ja: "NASDAQ100", en: "NASDAQ 100" },
  { id: "sp500", key: "SPX", ja: "S&P500", en: "S&P 500" },
] as const;
export type IndexQuote = { id: string; ja: string; en: string; value: number; percentChange: number | null; proxy: string | null; asOf: string; marketOpen: boolean; line: number[]; extended: MarketQuote["extended"] };
/** The real indices. Only when the provider will not serve an index does its ETF stand in, and the column then says so. */
export const loadIndices = unstable_cache(async (): Promise<IndexQuote[]> => {
  const out: IndexQuote[] = [];
  await Promise.all(INDICES.map(async index => {
    let id: string = index.key, proxy: string | null = null, found: { quote: MarketQuote | null } | null = null;
    try { found = await resolveMarket(index.key); }
    catch {
      const fallback = MARKET_SYMBOLS[index.key].fallback;
      if (fallback) { proxy = fallback; id = fallback; try { found = await resolveMarket(fallback); } catch { /* left out */ } }
    }
    const quote = found?.quote;
    if (!quote) return;
    const bars = await loadBars(id, "1d").catch(() => []);
    out.push({ id: index.id, ja: index.ja, en: index.en, value: quote.price, percentChange: quote.percentChange, proxy, asOf: quote.asOf, marketOpen: quote.marketOpen, line: bars.map(b => b.close), extended: quote.extended });
  }));
  return INDICES.flatMap(index => out.filter(item => item.id === index.id));
}, ["market-indices-v5"], { revalidate: 60 });
