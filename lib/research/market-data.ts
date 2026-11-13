import "server-only";
import { unstable_cache } from "next/cache";
import { calendarEvents, dateOnlyEarnings } from "./calendar";
import { shapePeriod, periodSeries, isIntradayPeriod, type BoardPeriod } from "./market-board-periods.ts";
import { FAST_REFRESH_BUDGET, creditWindow, fitsBudget, parseUsage, quotesToRead } from "./quote-refresh-gate.ts";
import { easternToIso, chartSpec, nextEarningsFromSite, parseBars, parseNextEarnings, parseQuote, parseQuotes, parseStatistics, splitBars, type Bar, type ChartRange, type MarketFacts, type MarketQuote } from "./market-quote";

/** Server-side Twelve Data reads for the price screens. The key (TWELVE_DATA_API_KEY) never leaves the server. */
// The quote is asked with the default (daily) interval: with interval=1min the change, high, low, previous close and volume all describe the LAST MINUTE
// (owner, Nov 11: SPY -0.007%, MU volume 2,238). prepost=true adds the pre-market / after-hours fields and a fresh last_quote_at.
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
    spent.record(creditCost(path, params));
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
    if (response.status === 429 && attempt < 2) { await new Promise(r => setTimeout(r, 4000 * (attempt + 1))); continue; }
    if (!response.ok) { const text = await response.text().catch(() => ""); throw new Error(`twelve-data ${path} ${response.status} ${text.replace(/apikey=[^&"\s]*/gi, "").slice(0, 140)}`); }
    const body = await response.json() as { status?: unknown; code?: unknown; message?: unknown };
    if (body?.status === "error") throw new Error(`twelve-data ${path} ${String(body.code)} ${String(body.message).slice(0, 120)}`);
    return body;
  }
  throw new Error(`twelve-data ${path} rate-limited`);
}

// This process's spending (a floor for the minute's usage) and the provider's own meter, read at most every ten seconds (one credit a read).
const spent = creditWindow();
const creditCost = (path: string, params: Record<string, string>) => path === "statistics" ? 50 : path === "earnings" ? 20 : path === "quote" ? (params.symbol ?? "").split(",").length : 1;
let usageMemo: { at: number; used: number | null; localAt: number } | null = null;
async function minuteUsage(): Promise<number> {
  if (!usageMemo || Date.now() - usageMemo.at >= 10_000) {
    let used: number | null = null;
    const key = process.env.TWELVE_DATA_API_KEY;
    try {
      spent.record(1);
      const response = await fetch(`${BASE()}/api_usage?apikey=${encodeURIComponent(key ?? "")}`, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
      if (response.ok) used = parseUsage(await response.json().catch(() => null));
    } catch { /* the local count stands in */ }
    usageMemo = { at: Date.now(), used, localAt: spent.total() };
  }
  const local = spent.total();
  return usageMemo.used === null ? local : Math.max(local, usageMemo.used + Math.max(0, local - usageMemo.localAt));
}

// One-minute memory cache per ticker (and in-flight sharing), so a busy minute costs each symbol one request.
// `fast` (the watchlist and a stock's page): a quote older than 15 seconds is read again when the minute's usage leaves room for it (quote-refresh-gate.ts).
const quoteMemory = new Map<string, { at: number; quote: MarketQuote | null }>();
const pending = new Map<string, Promise<void>>();
export async function loadMarketQuotes(tickers: string[], options: { fast?: boolean } = {}): Promise<Record<string, MarketQuote>> {
  return (await loadMarketQuotesWithRefresh(tickers, options)).quotes;
}
/** As loadMarketQuotes, and says whether the 15-second refresh was granted (`fast`), for the response header. */
export async function loadMarketQuotesWithRefresh(tickers: string[], { fast = false }: { fast?: boolean } = {}): Promise<{ quotes: Record<string, MarketQuote>; fast: boolean }> {
  const wanted = [...new Set(tickers)];
  const now = Date.now();
  const ages = Object.fromEntries(wanted.map(t => [t, now - (quoteMemory.get(t)?.at ?? -Infinity)]));
  let plan = quotesToRead(ages, fast, () => true);
  if (plan.read.length > quotesToRead(ages, false, () => false).read.length) {
    const used = await minuteUsage();
    plan = quotesToRead(ages, true, extra => fitsBudget(used, extra, FAST_REFRESH_BUDGET));
  }
  const stale = plan.read, granted = plan.fast;
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
  return { quotes: out, fast: granted };
}

type Variant = Record<string, string>;
/** What the market page shows besides stocks: ETFs (SPY / QQQ / DIA stand for the three indices, which Twelve Data does not carry), forex, crypto and metals.
 * Every entry lists the ways to ask the provider for it, tried in turn; an ETF can trade on several venues. `search` names a word to look up in the provider's
 * symbol search when none of the usual ways answers (copper's symbol is not one we know), and the answer is written to the log. A symbol that cannot be
 * read is left out of the screen, never stops it. */
type Market = { variants: readonly Variant[]; search?: string };
const etf = (...mics: string[]): Variant[] => [...mics.map(mic_code => ({ mic_code })), {}];
export const MARKET_SYMBOLS: Record<string, Market> = {
  SPY: { variants: etf("ARCX") }, QQQ: { variants: etf("XNMS", "XNGS", "XNAS") }, DIA: { variants: etf("ARCX") },
  SMH: { variants: etf("XNMS", "XNAS", "XNGS") }, SOXX: { variants: etf("XNMS", "XNAS", "XNGS") },
  SHY: { variants: etf("XNMS", "XNAS", "XNGS") }, IEF: { variants: etf("XNMS", "XNAS", "XNGS") }, TLT: { variants: etf("XNMS", "XNAS", "XNGS") },
  "USD/JPY": { variants: [{}] }, "EUR/JPY": { variants: [{}] }, "EUR/USD": { variants: [{}] }, "GBP/USD": { variants: [{}] },
  "BTC/USD": { variants: [{}] }, "ETH/USD": { variants: [{}] }, "SOL/USD": { variants: [{}] }, "XRP/USD": { variants: [{}] },
  "XAU/USD": { variants: [{}] }, "XAG/USD": { variants: [{}] }, "XPT/USD": { variants: [{}] },
  "XCU/USD": { variants: [{}, { symbol: "COPPER" }], search: "copper" },
};
export const isMarketChartSymbol = (symbol: string) => Object.hasOwn(MARKET_SYMBOLS, symbol);

const resolved = new Map<string, { variant: Variant; quote: MarketQuote; at: number } | null>();
const QUOTE_TTL = 60_000;
/** The first way of asking that answers (the answer is kept a minute; a refusal twenty seconds). */
async function resolveMarket(id: string, ttl = QUOTE_TTL): Promise<{ symbol: string; extra: Variant; quote: MarketQuote | null }> {
  const entry = MARKET_SYMBOLS[id];
  const hit = resolved.get(id);
  if (hit === null) throw new Error(`unresolved ${id}`);
  if (hit && hit.at + ttl > Date.now()) { const { symbol = id, ...extra } = hit.variant; return { symbol, extra, quote: hit.quote }; }
  const tried: string[] = [];
  const attempt = async (variant: Variant): Promise<{ symbol: string; extra: Variant; quote: MarketQuote | null } | null> => {
    const { symbol = id, ...extra } = variant;
    try {
      const quote = parseQuote(await call("quote", { symbol, ...extra, prepost: "true" }), symbol);
      if (!quote) throw new Error("no quote");
      resolved.set(id, { variant, quote, at: Date.now() });
      return { symbol, extra, quote };
    } catch (error) { tried.push(`${JSON.stringify(variant)}: ${error instanceof Error ? error.message : "failed"}`); return null; }
  };
  const order = hit ? [hit.variant, ...entry.variants.filter(v => v !== hit.variant)] : entry.variants;
  for (const variant of order) { const got = await attempt(variant); if (got) return got; }
  if (entry.search) {
    try {
      const body = await call("symbol_search", { symbol: entry.search, outputsize: "10" }) as { data?: { symbol?: unknown; instrument_name?: unknown; exchange?: unknown; instrument_type?: unknown }[] };
      const list = (Array.isArray(body?.data) ? body.data : []).filter(item => typeof item.symbol === "string");
      console.warn(`market symbol ${id}: the provider's search for "${entry.search}" lists ${list.map(item => `${item.symbol} (${String(item.instrument_name)}, ${String(item.exchange)}, ${String(item.instrument_type)})`).join("; ") || "nothing"}`);
      for (const item of list.slice(0, 4)) { const got = await attempt({ symbol: String(item.symbol), ...(typeof item.exchange === "string" && item.exchange ? { exchange: item.exchange } : {}) }); if (got) return got; }
    } catch (error) { tried.push(`symbol search: ${error instanceof Error ? error.message : "failed"}`); }
  }
  console.warn(`market symbol ${id} could not be resolved. ${tried.join(" | ")}`);
  resolved.set(id, null); setTimeout(() => resolved.delete(id), 20_000); // short: a rate-limit blip must not hide a symbol for minutes
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
  try {
    let raw: unknown;
    if (entry) {
      const target = await resolveMarket(ticker);
      raw = await call("time_series", { symbol: target.symbol, ...base, ...target.extra });
    } else raw = await call("time_series", { symbol: ticker, ...base });
    const all = parseBars(raw);
    barMemory.set(memoryKey, { at: Date.now(), all });
    return all;
  } catch (error) {
    if (hit && hit.all.length) return hit.all; // the provider blinked: show the last good bars instead of an empty chart
    throw error;
  }
}
/** Board charts keep their own memory, so the 15-second refresh of the 5 / 15 / 60 / 180-minute candles never touches the watchlist's (60 seconds).
 * The daily and weekly series change by one candle a day: the candle body is kept 60 seconds, the live price comes from the quote. */
const FAST_BAR_TTL = 15_000, SLOW_BAR_TTL = 60_000;
const periodMemory = new Map<string, { at: number; all: Bar[] }>();
async function readSeries(ticker: string, interval: string, size: number, ttl: number): Promise<Bar[]> {
  const memoryKey = `${ticker}|${interval}|${size}`, hit = periodMemory.get(memoryKey);
  if (hit && hit.at + ttl > Date.now()) return hit.all;
  const base = { interval, outputsize: String(size), order: "desc", ...(interval === "5min" || interval === "15min" || interval === "30min" ? { prepost: "true" } : {}) };
  try {
    const target = MARKET_SYMBOLS[ticker] ? await resolveMarket(ticker) : null;
    const all = parseBars(target ? await call("time_series", { symbol: target.symbol, ...base, ...target.extra }) : await call("time_series", { symbol: ticker, ...base }));
    periodMemory.set(memoryKey, { at: Date.now(), all });
    return all;
  } catch (error) {
    if (hit && hit.all.length) return hit.all; // the provider blinked: show the last good bars instead of an empty chart
    throw error;
  }
}
/** The bars of one board period (see market-board-periods.ts) and the bars before them. */
export async function loadPeriodSet(ticker: string, period: BoardPeriod): Promise<{ bars: Bar[]; before: Bar[] }> {
  const series = periodSeries(period);
  return shapePeriod(period, await readSeries(ticker, series.interval, series.size, isIntradayPeriod(period) ? FAST_BAR_TTL : SLOW_BAR_TTL));
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
/** The price board: one quote per requested symbol (those that cannot be read are simply absent, and logged). */
export type BoardQuote = { id: string; price: number; change: number | null; percentChange: number | null; currency: string; asOf: string; marketOpen: boolean; extended: MarketQuote["extended"]; high: number | null; low: number | null; open: number | null; volume: number | null };
/** `fast` (the three index cards and the chart being looked at) keeps a quote 15 seconds; everything else on the board keeps it a minute, as before. */
export async function loadBoard(ids: string[], fast = false): Promise<BoardQuote[]> {
  const out: BoardQuote[] = [];
  await Promise.all(ids.filter(isMarketChartSymbol).map(async id => {
    try {
      const { quote } = await resolveMarket(id, fast ? 15_000 : QUOTE_TTL);
      if (quote) out.push({ id, price: quote.price, change: quote.change, percentChange: quote.percentChange, currency: quote.currency, asOf: quote.asOf, marketOpen: quote.marketOpen, extended: quote.extended, high: quote.high, low: quote.low, open: quote.open, volume: quote.volume });
    } catch { /* logged by resolveMarket */ }
  }));
  return ids.flatMap(id => out.filter(item => item.id === id));
}
