import "server-only";
import { unstable_cache } from "next/cache";
import { calendarEvents, dateOnlyEarnings } from "./calendar";
import { shapePeriod, periodSeries, isIntradayPeriod, type BoardPeriod } from "./market-board-periods.ts";
import { FAST_QUOTE_TTL_MS } from "./quote-refresh-gate.ts";
import { MAX_QUOTES_PER_REQUEST, MAX_SPARKLINES_PER_REQUEST, STALE_LIMIT_MS, barSlotMs, quoteSlotMs, type ReadSpec, type Tier } from "./twelve-budget.ts";
import { isBudgetError, sharedReader, twelveCall } from "./twelve-gateway";
import { cachedStatistics } from "./twelve-store";
import { easternToIso, chartSpec, nextEarningsFromSite, parseBars, parseNextEarnings, parseQuote, parseQuotes, parseStatistics, splitBars, type Bar, type ChartRange, type MarketFacts, type MarketQuote } from "./market-quote";

/** Server-side Twelve Data reads for the price screens. The key (TWELVE_DATA_API_KEY) never leaves the server.
 * Owner, Nov 23: members opening 銘柄比較 and stock pages had used up the plan's minute before. Every read now goes through the shared reader
 * (lib/research/twelve-budget.ts): one provider read per symbol and time slot for every instance and member, a governed call that is never
 * retried, and the last good copy (with its own time) when the minute has no room. A page's cost no longer grows with the number of members. */
// The quote is asked with the default (daily) interval: with interval=1min the change, high, low, previous close and volume all describe the LAST MINUTE
// (owner, Nov 11: SPY -0.007%, MU volume 2,238). prepost=true adds the pre-market / after-hours fields and a fresh last_quote_at.
export const marketDataConfigured = () => !!process.env.TWELVE_DATA_API_KEY;

const call = (path: string, params: Record<string, string>, tier: Tier = "user") => twelveCall(path, params, { tier });
const quoteSpec = (now: number): ReadSpec => ({ name: "md-quote-v1", slotMs: quoteSlotMs("AAPL", now), staleMs: STALE_LIMIT_MS });

async function fetchQuotes(group: string[], tier: Tier = "user"): Promise<Map<string, MarketQuote | null>> {
  const parsed = parseQuotes(await call("quote", { symbol: group.join(","), prepost: "true" }, tier), group);
  return new Map(group.map(t => [t, parsed[t] ?? null]));
}

export async function loadMarketQuotes(tickers: string[], options: { fast?: boolean } = {}): Promise<Record<string, MarketQuote>> {
  return (await loadMarketQuotesWithRefresh(tickers, options)).quotes;
}
/** Quotes from the shared one-minute copy (fifteen minutes while stocks do not trade). At most MAX_QUOTES_PER_REQUEST symbols are read from
 * the provider for one request, never-read and oldest first; the others keep their last good copy, whose own time the screen shows.
 * `fast` (the watchlist and a stock's page): a copy older than 15 seconds is read again only on a quiet minute (the "fast" tier, 200). */
export async function loadMarketQuotesWithRefresh(tickers: string[], { fast = false }: { fast?: boolean } = {}): Promise<{ quotes: Record<string, MarketQuote>; fast: boolean; stale: number }> {
  const spec = quoteSpec(Date.now());
  const got = await sharedReader.readMany<MarketQuote>(spec, tickers, group => fetchQuotes(group), { maxFetch: MAX_QUOTES_PER_REQUEST });
  let granted = fast;
  if (fast) {
    const older = Object.keys(got).filter(t => got[t].fresh && got[t].value && Date.now() - got[t].at >= FAST_QUOTE_TTL_MS).slice(0, 12);
    if (older.length) {
      try {
        const values = await fetchQuotes(older, "fast"), at = Date.now();
        for (const t of older) { const quote = values.get(t); if (quote) { got[t] = { value: quote, at, fresh: true }; await sharedReader.save(spec, t, { value: quote, at }); } }
      } catch { granted = false; }
    }
  }
  const out: Record<string, MarketQuote> = {};
  let stale = 0;
  for (const t of new Set(tickers)) { const hit = got[t]; if (hit?.value) { out[t] = hit.value; if (!hit.fresh) stale++; } }
  return { quotes: out, fast: granted, stale };
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

type Board = { variant: Variant; quote: MarketQuote };
const resolvedVariant = new Map<string, Variant>();
const unresolved = new Map<string, number>();
/** The first way of asking that answers. A symbol no way could serve is not asked again for twenty seconds (short: a rate-limit blip must not
 * hide a symbol for minutes); a refused minute is not a failure of the symbol and stops the attempts at once. */
async function resolveFresh(id: string): Promise<Board> {
  if ((unresolved.get(id) ?? 0) > Date.now()) throw new Error(`unresolved ${id}`);
  const entry = MARKET_SYMBOLS[id], known = resolvedVariant.get(id);
  const tried: string[] = [];
  let refused = false;
  const attempt = async (variant: Variant): Promise<Board | null> => {
    const { symbol = id, ...extra } = variant;
    try {
      const quote = parseQuote(await call("quote", { symbol, ...extra, prepost: "true" }), symbol);
      if (!quote) throw new Error("no quote");
      resolvedVariant.set(id, variant);
      return { variant, quote };
    } catch (error) { if (isBudgetError(error)) refused = true; tried.push(`${JSON.stringify(variant)}: ${error instanceof Error ? error.message : "failed"}`); return null; }
  };
  const order = known ? [known, ...entry.variants.filter(v => v !== known)] : entry.variants;
  for (const variant of order) { if (refused) break; const got = await attempt(variant); if (got) return got; }
  if (entry.search && !refused) {
    try {
      const body = await call("symbol_search", { symbol: entry.search, outputsize: "10" }) as { data?: { symbol?: unknown; instrument_name?: unknown; exchange?: unknown; instrument_type?: unknown }[] };
      const list = (Array.isArray(body?.data) ? body.data : []).filter(item => typeof item.symbol === "string");
      console.warn(`market symbol ${id}: the provider's search for "${entry.search}" lists ${list.map(item => `${item.symbol} (${String(item.instrument_name)}, ${String(item.exchange)}, ${String(item.instrument_type)})`).join("; ") || "nothing"}`);
      for (const item of list.slice(0, 4)) { const got = await attempt({ symbol: String(item.symbol), ...(typeof item.exchange === "string" && item.exchange ? { exchange: item.exchange } : {}) }); if (got) return got; }
    } catch (error) { tried.push(`symbol search: ${error instanceof Error ? error.message : "failed"}`); }
  }
  if (!refused) { console.warn(`market symbol ${id} could not be resolved. ${tried.join(" | ")}`); unresolved.set(id, Date.now() + 20_000); }
  throw new Error(`unresolved ${id}`);
}
/** `fast` (the three index cards and the chart being looked at) keeps a quote 15 seconds; everything else on the board a minute. */
const boardSpec = (fast: boolean): ReadSpec => ({ name: "md-board-v1", slotMs: fast ? 15_000 : 60_000, staleMs: STALE_LIMIT_MS });
async function boardEntry(id: string, fast: boolean): Promise<Board | null> {
  const got = await sharedReader.read<Board>(boardSpec(fast), id, () => resolveFresh(id));
  if (got) resolvedVariant.set(id, got.value.variant);
  return got?.value ?? null;
}
async function marketTarget(id: string): Promise<{ symbol: string; extra: Variant }> {
  const variant = resolvedVariant.get(id) ?? (await boardEntry(id, false))?.variant;
  if (!variant) throw new Error(`unresolved ${id}`);
  const { symbol = id, ...extra } = variant;
  return { symbol, extra };
}

/** Pre-market / after-hours bars exist only for U.S. stocks and ETFs. For a currency pair, crypto or metal (board ids "USD/JPY", "BTC/USD", "XCU/USD"…) the provider
 * refuses intraday series that ask for them ("Pre/post data is available only for 1min interval"), which left the board's 5- and 15-minute charts
 * empty for every non-stock symbol (owner, Nov 14). Those symbols trade around the clock and are asked without it. */
export function intradayParams(symbol: string, interval: string): { prepost?: "true" } {
  return (interval === "5min" || interval === "15min" || interval === "30min") && !symbol.includes("/") ? { prepost: "true" } : {};
}
/** One bar series from the shared copy of its slot (one provider credit for everyone), else the last good copy. `fetch` false: copies only. */
async function bars(ticker: string, interval: string, size: number, { slotMs, fetch = true }: { slotMs?: number; fetch?: boolean } = {}): Promise<Bar[]> {
  const spec: ReadSpec = { name: "md-bars-v1", slotMs: slotMs ?? barSlotMs(ticker, interval, Date.now()), staleMs: STALE_LIMIT_MS };
  const got = await sharedReader.read<Bar[]>(spec, `${ticker}|${interval}|${size}`, fetch ? async () => {
    const base = { interval, outputsize: String(size), order: "desc" };
    const target = MARKET_SYMBOLS[ticker] ? await marketTarget(ticker) : null;
    return parseBars(target ? await call("time_series", { symbol: target.symbol, ...base, ...intradayParams(ticker, interval), ...target.extra })
      : await call("time_series", { symbol: ticker, ...base, ...intradayParams(ticker, interval) }));
  } : null);
  if (!got) throw new Error("bars-unavailable");
  return got.value;
}
/** Every bar fetched for a range (the drawn ones and the ones before them). Pre-market and after-hours bars are included for 1D / 1W. */
const readAll = (ticker: string, range: ChartRange, options?: { slotMs?: number; fetch?: boolean }) => { const spec = chartSpec(range); return bars(ticker, spec.interval, spec.size, options); };
/** The bars of one board period (see market-board-periods.ts) and the bars before them. Intraday candles are shared a minute (the live price
 * comes from the quote), daily and longer at least ten minutes. */
export async function loadPeriodSet(ticker: string, period: BoardPeriod): Promise<{ bars: Bar[]; before: Bar[] }> {
  const series = periodSeries(period);
  return shapePeriod(period, await bars(ticker, series.interval, series.size, isIntradayPeriod(period) ? {} : { slotMs: Math.max(10 * 60_000, barSlotMs(ticker, series.interval, Date.now())) }));
}

/** About five years of daily closes for a stock page's period change (1W … 5Y, YTD); shared 30 minutes (one credit a read). */
export async function loadDailyCloses(ticker: string): Promise<Bar[]> {
  try { return await bars(ticker, "1day", 1300, { slotMs: 30 * 60_000 }); }
  catch (error) {
    // Production QA, Nov 24: under load the five-year series could not be read and the stock page lost its period change (503). The
    // one-year daily series of the period buttons, when a copy is already stored, still gives 1W … 1Y and YTD. Copies only: no provider call.
    const series = periodSeries("1y");
    const copy = await bars(ticker, series.interval, series.size, { fetch: false, slotMs: Math.max(10 * 60_000, barSlotMs(ticker, series.interval, Date.now())) }).catch(() => null);
    if (copy?.length) return copy;
    throw error;
  }
}

/** The drawn bars of a range plus the bars before them (for the moving averages). */
export async function loadBarSet(ticker: string, range: ChartRange): Promise<{ bars: Bar[]; before: Bar[] }> { return splitBars(await readAll(ticker, range), range); }
export async function loadBars(ticker: string, range: ChartRange): Promise<Bar[]> { return (await loadBarSet(ticker, range)).bars; }

const easternDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
/** The 5-minute bars each watchlist row's chart needs: those of the day its price belongs to (the regular session's day, and the day of the pre-market /
 * after-hours price when that is a different day: before the open, the new day has only a few pre-market bars). Owner, Nov 11: charts vanished at 5am ET.
 * A sparkline is shared five minutes (one new 5-minute bar at most); one request reads at most MAX_SPARKLINES_PER_REQUEST of them from the provider. */
export async function loadIntraday(quotes: MarketQuote[]): Promise<Record<string, Bar[]>> {
  const out: Record<string, Bar[]> = {};
  let allowance = MAX_SPARKLINES_PER_REQUEST;
  await Promise.all(quotes.map(async q => {
    try {
      const days = new Set([easternDay.format(Date.parse(q.asOf)), ...(q.extended ? [easternDay.format(Date.parse(q.extended.asOf))] : [])]);
      const all = await readAll(q.ticker, "1d", { slotMs: 5 * 60_000, fetch: allowance-- > 0 });
      out[q.ticker] = all.filter(bar => { const iso = easternToIso(bar.at); return iso !== "" && days.has(easternDay.format(Date.parse(iso))); });
    } catch { out[q.ticker] = []; }
  }));
  return out;
}

class FactsRefused extends Error { constructor() { super("facts-refused"); } }
/** Statistics: the comparison's daily copy of every US-listed company first (no credit); the provider (50 credits) only for one it lacks. */
async function statisticsFor(ticker: string): Promise<unknown> {
  const stored = await cachedStatistics(ticker).catch(() => null);
  if (stored) return stored.payload;
  return call("statistics", { symbol: ticker });
}
const factsRunning = new Map<string, Promise<MarketFacts>>();
const facts = (ticker: string) => unstable_cache(async (): Promise<MarketFacts> => {
  const today = new Date().toISOString().slice(0, 10);
  const own = nextEarningsFromSite(ticker, [...calendarEvents, ...dateOnlyEarnings], today);
  // The provider's earnings date (20 credits) only when the site's own calendar has none.
  const [stats, earnings] = await Promise.allSettled([statisticsFor(ticker), own ? Promise.resolve(null) : call("earnings", { symbol: ticker, period: "next" })]);
  // A refused read is never stored for six hours: the next request (or the comparison's daily job) fills it.
  if ((stats.status === "rejected" && isBudgetError(stats.reason)) || (earnings.status === "rejected" && isBudgetError(earnings.reason))) throw new FactsRefused();
  const parsed = stats.status === "fulfilled" ? parseStatistics(stats.value, ticker) : null;
  const provider = earnings.status === "fulfilled" && earnings.value ? parseNextEarnings(earnings.value, today) : null;
  if (!parsed && stats.status === "rejected" && earnings.status === "rejected") throw new Error("facts-unavailable");
  return { eps: parsed?.eps ?? null, marketCap: parsed?.marketCap ?? null, dividendYield: parsed?.dividendYield ?? null, nextEarnings: own ?? provider };
}, ["market-facts-v1", ticker], { revalidate: 6 * 3600 })();
/** EPS, market cap, dividend yield and the next earnings date. The site's own calendar wins over the provider's. A failed or refused read is
 * never cached; members asking for the same company at once share one read. */
export async function loadMarketFacts(ticker: string): Promise<MarketFacts> {
  try {
    let job = factsRunning.get(ticker);
    if (!job) { job = facts(ticker).finally(() => factsRunning.delete(ticker)); factsRunning.set(ticker, job); }
    return await job;
  } catch { return { eps: null, marketCap: null, dividendYield: null, nextEarnings: nextEarningsFromSite(ticker, [...calendarEvents, ...dateOnlyEarnings], new Date().toISOString().slice(0, 10)) }; }
}

/** Owner, Nov 11: the index symbols (DJI / NDX / SPX) answered with other securities on this plan (a $21 and a $0.1 quote), so the
 * panel reads the three ETFs that track them. The percentage is the ETF's and the column says so; never mix in an unchecked symbol. */
/** The price board: one quote per requested symbol (those that cannot be read are simply absent, and logged). */
export type BoardQuote = { id: string; price: number; change: number | null; percentChange: number | null; currency: string; asOf: string; marketOpen: boolean; extended: MarketQuote["extended"]; high: number | null; low: number | null; open: number | null; volume: number | null };
export async function loadBoard(ids: string[], fast = false): Promise<BoardQuote[]> {
  const out: BoardQuote[] = [];
  await Promise.all(ids.filter(isMarketChartSymbol).map(async id => {
    const quote = (await boardEntry(id, fast))?.quote;
    if (quote) out.push({ id, price: quote.price, change: quote.change, percentChange: quote.percentChange, currency: quote.currency, asOf: quote.asOf, marketOpen: quote.marketOpen, extended: quote.extended, high: quote.high, low: quote.low, open: quote.open, volume: quote.volume });
  }));
  return ids.flatMap(id => out.filter(item => item.id === id));
}

/** マーケット「レバETF」(owner, Nov 25): the funds and the stocks under them (lib/research/leveraged-etfs.ts), about 90 symbols. They are read in
 * batched quotes (12 symbols a call, one credit each) through the same lease as every other read, and kept two minutes for everyone (fifteen while
 * stocks do not trade), so the tab costs at most ~45 credits a minute however many members look at it. One request reads at most 48 of them from
 * the provider; the others show their last good copy, or come with the next poll (`missing` counts them). */
const LEVERAGED_SLOT_MS = 2 * 60_000, LEVERAGED_MAX_FETCH = 48;
const leveragedSpec = (now: number): ReadSpec => ({ name: "md-lev-v1", slotMs: Math.max(LEVERAGED_SLOT_MS, quoteSlotMs("AAPL", now)), staleMs: STALE_LIMIT_MS });
export async function loadLeveragedQuotes(symbols: readonly string[]): Promise<{ quotes: Record<string, MarketQuote>; missing: number }> {
  const got = await sharedReader.readMany<MarketQuote>(leveragedSpec(Date.now()), [...symbols], group => fetchQuotes(group), { maxFetch: LEVERAGED_MAX_FETCH });
  const quotes: Record<string, MarketQuote> = {};
  for (const symbol of symbols) { const value = got[symbol]?.value; if (value) quotes[symbol] = value; }
  return { quotes, missing: symbols.filter(symbol => !got[symbol]).length };
}
