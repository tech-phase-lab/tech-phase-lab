import "server-only";
import { unstable_cache } from "next/cache";
import { calendarEvents, dateOnlyEarnings } from "./calendar";
import { easternToIso, chartSpec, nextEarningsFromSite, parseBars, parseNextEarnings, parseQuote, parseQuotes, parseStatistics, splitBars, type Bar, type ChartRange, type MarketFacts, type MarketQuote } from "./market-quote";

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
    if (!response.ok) { const text = await response.text().catch(() => ""); throw new Error(`twelve-data ${path} ${response.status} ${text.replace(/apikey=[^&"\s]*/gi, "").slice(0, 140)}`); }
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
      job = call("quote", { symbol: id, interval: "1min", prepost: "true" }).then(raw => {
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
/** What the market page charts besides stocks. Every entry lists the ways to ask the provider for it, tried in turn. `name` checks the answer is the
 * right instrument (a bare index symbol such as SPX is also an ordinary stock's ticker); `catalog` is a pattern for the provider's own list of indices
 * (/indices), whose symbols are tried when the usual ones answer nothing. An ETF can trade on several venues, so each lists the exchanges to try. */
type Market = { variants: readonly Variant[]; name?: RegExp; catalog?: RegExp };
const etf = (...mics: string[]): Variant[] => [...mics.map(mic_code => ({ mic_code })), {}];
export const MARKET_SYMBOLS: Record<string, Market> = {
  SPX: { variants: [{ symbol: "SPX", type: "Index" }, { symbol: "SPX", exchange: "INDEX" }, { symbol: "GSPC" }, { symbol: "SPX" }], name: /s&p\s*500/i, catalog: /s&p\s*500\b/i },
  NDX: { variants: [{ symbol: "NDX", type: "Index" }, { symbol: "NDX", exchange: "INDEX" }, { symbol: "NDX" }], name: /nasdaq[\s-]*100/i, catalog: /nasdaq[\s-]*100/i },
  DJI: { variants: [{ symbol: "DJI", type: "Index" }, { symbol: "DJI", exchange: "INDEX" }, { symbol: "DJIA" }, { symbol: "DJI" }], name: /dow\s*jones/i, catalog: /dow\s*jones\s*industrial/i },
  SHY: { variants: etf("XNMS", "XNAS", "XNGS") }, IEF: { variants: etf("XNMS", "XNAS", "XNGS") }, TLT: { variants: etf("XNMS", "XNAS", "XNGS") },
  "USD/JPY": { variants: [{}] }, "EUR/USD": { variants: [{}] }, "EUR/JPY": { variants: [{}] },
};
export const isMarketChartSymbol = (symbol: string) => Object.hasOwn(MARKET_SYMBOLS, symbol);

let catalogMemory: { at: number; list: { symbol: string; name: string; exchange?: string }[] } | null = null;
/** The provider's own list of U.S. indices (cached a day), to learn the symbol it uses for each. */
async function indexCatalog() {
  if (catalogMemory && catalogMemory.at + 86_400_000 > Date.now()) return catalogMemory.list;
  const body = await call("indices", { country: "United States" }) as { data?: { symbol?: unknown; name?: unknown; exchange?: unknown }[] };
  const list = (Array.isArray(body?.data) ? body.data : []).flatMap(item => typeof item.symbol === "string" && typeof item.name === "string" ? [{ symbol: item.symbol, name: item.name, ...(typeof item.exchange === "string" ? { exchange: item.exchange } : {}) }] : []);
  catalogMemory = { at: Date.now(), list };
  return list;
}

const resolved = new Map<string, { variant: Variant; at: number } | null>();
/** The first way of asking that answers with the right instrument (cached for an hour, a refusal for five minutes so a bad key does not burn credits). */
async function resolveMarket(id: string): Promise<{ symbol: string; extra: Variant; quote: MarketQuote | null }> {
  const entry = MARKET_SYMBOLS[id];
  const hit = resolved.get(id);
  if (hit === null) throw new Error(`unresolved ${id}`);
  const tried: string[] = [];
  const attempt = async (variant: Variant): Promise<{ symbol: string; extra: Variant; quote: MarketQuote | null } | null> => {
    const { symbol = id, ...extra } = variant;
    try {
      const quote = parseQuote(await call("quote", { symbol, ...extra, interval: "1min", prepost: "true" }), symbol);
      if (!quote) throw new Error("no quote");
      if (entry.name && !entry.name.test(quote.name)) throw new Error(`other instrument "${quote.name}"`);
      resolved.set(id, { variant, at: Date.now() });
      return { symbol, extra, quote };
    } catch (error) { tried.push(`${JSON.stringify(variant)}: ${error instanceof Error ? error.message : "failed"}`); return null; }
  };
  const order = hit ? [hit.variant, ...entry.variants.filter(v => v !== hit.variant)] : entry.variants;
  for (const variant of order) { const got = await attempt(variant); if (got) return got; }
  if (entry.catalog) {
    try {
      const found = (await indexCatalog()).filter(item => entry.catalog!.test(item.name));
      console.warn(`market symbol ${id}: the provider lists ${found.map(item => `${item.symbol} (${item.name}${item.exchange ? ", " + item.exchange : ""})`).join("; ") || "nothing"}`);
      for (const item of found) for (const variant of [{ symbol: item.symbol }, { symbol: item.symbol, type: "Index" }, ...(item.exchange ? [{ symbol: item.symbol, exchange: item.exchange }] : [])] as Variant[]) { const got = await attempt(variant); if (got) return got; }
    } catch (error) { tried.push(`indices list: ${error instanceof Error ? error.message : "failed"}`); }
  }
  console.warn(`market symbol ${id} could not be resolved. ${tried.join(" | ")}`);
  resolved.set(id, null); setTimeout(() => resolved.delete(id), 5 * 60_000);
  throw new Error(`unresolved ${id}`);
}

const barMemory = new Map<string, { at: number; all: Bar[] }>();
/** Every bar fetched for a range (the drawn ones and the ones before them). Pre-market and after-hours bars are included for 1D / 1W. */
async function readAll(ticker: string, range: ChartRange): Promise<Bar[]> {
  const memoryKey = `${ticker}:${range}`, hit = barMemory.get(memoryKey);
  const spec = chartSpec(range), intraday = spec.interval === "5min" || spec.interval === "30min";
  if (hit && hit.at + (intraday ? TTL : 5 * TTL) > Date.now()) return hit.all;
  const entry = MARKET_SYMBOLS[ticker];
  const base = { interval: spec.interval, outputsize: String(spec.size), order: "desc", ...(intraday ? { prepost: "true" } : {}) };
  let raw: unknown;
  if (entry) {
    const target = await resolveMarket(ticker);
    raw = await call("time_series", { symbol: target.symbol, ...base, ...target.extra });
  } else raw = await call("time_series", { symbol: ticker, ...base });
  const all = parseBars(raw);
  barMemory.set(memoryKey, { at: Date.now(), all });
  return all;
}
/** The drawn bars of a range plus the bars before them (for the moving averages). */
export async function loadBarSet(ticker: string, range: ChartRange): Promise<{ bars: Bar[]; before: Bar[] }> { return splitBars(await readAll(ticker, range), range); }
export async function loadBars(ticker: string, range: ChartRange): Promise<Bar[]> { return (await loadBarSet(ticker, range)).bars; }

const easternDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
/** The 5-minute bars each watchlist row's chart needs: those of the day its price belongs to (the regular session's day, and the day of the pre-market /
 * after-hours price when that is a different day: before the open, the new day has only a few pre-market bars). Owner, Nov 11: charts vanished at 5am ET. */
export async function loadIntraday(quotes: MarketQuote[]): Promise<Record<string, Bar[]>> {
  const out: Record<string, Bar[]> = {};
  await Promise.all(quotes.map(async q => {
    try {
      const days = new Set([easternDay.format(Date.parse(q.asOf)), ...(q.extended ? [easternDay.format(Date.parse(q.extended.asOf))] : [])]);
      out[q.ticker] = (await readAll(q.ticker, "1d")).filter(bar => { const iso = easternToIso(bar.at); return iso !== "" && days.has(easternDay.format(Date.parse(iso))); });
    } catch { out[q.ticker] = []; }
  }));
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
export type IndexQuote = { id: string; ja: string; en: string; symbol: string; value: number; percentChange: number | null; asOf: string; marketOpen: boolean; extended: MarketQuote["extended"] };
/** The real indices only (owner, Nov 11: "if it can only show ETF prices, we don't need it"). An index the provider does not serve is left out, and with
 * none the page shows no index panel; the reasons go to the log (every symbol tried, and the provider's own list of indices). */
export const loadIndices = unstable_cache(async (): Promise<IndexQuote[]> => {
  const out: IndexQuote[] = [];
  await Promise.all(INDICES.map(async index => {
    try {
      const { quote } = await resolveMarket(index.key);
      if (quote) out.push({ id: index.id, ja: index.ja, en: index.en, symbol: index.key, value: quote.price, percentChange: quote.percentChange, asOf: quote.asOf, marketOpen: quote.marketOpen, extended: quote.extended });
    } catch { /* logged by resolveMarket */ }
  }));
  return INDICES.flatMap(index => out.filter(item => item.id === index.id));
}, ["market-indices-v7"], { revalidate: 60 });
