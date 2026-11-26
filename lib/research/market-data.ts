import "server-only";
import { calendarEvents, dateOnlyEarnings } from "./calendar";
import { shapePeriod, periodSeries, isIntradayPeriod, type BoardPeriod } from "./market-board-periods.ts";
import { MAX_QUOTES_PER_REQUEST, MAX_SPARKLINES_PER_REQUEST, STALE_LIMIT_MS, barSlotMs, fastRefresh, quoteSlotMs, stocksTrading, type ReadSpec, type Result, type Tier } from "./twelve-budget.ts";
import { LEVERAGED_ETFS, leveragedDue, type LeveragedSnapshot } from "./leveraged-etfs.ts";
import { BOARD_SNAPSHOT_PERIOD, boardDue, boardJobKey } from "./market-snapshot.ts";
import { isBudgetError, sharedReader, twelveCall } from "./twelve-gateway";
import { cachedStatistics } from "./twelve-store";
import { MONITORED_EARNINGS_PER_MINUTE, MONITORED_FACTS_TICKERS, MONITORED_STATS_PER_MINUTE, factsDue, isMonitoredFactsTicker, type CopyState } from "./monitored-facts.ts";
import { easternToIso, chartSpec, nextEarningsFromSite, parseBars, parseNextEarnings, parseQuote, parseQuotes, parseStatistics, hasStatFacts, splitBars, type StatFacts, type Bar, type ChartRange, type MarketFacts, type MarketQuote } from "./market-quote";

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
  let granted = fast, all = got;
  // fast: one provider read per symbol and 15-second slot for everyone (twelve-budget.ts fastRefresh), under the "fast" tier (200).
  if (fast) ({ got: all, granted } = await fastRefresh<MarketQuote>(sharedReader, spec, got, group => fetchQuotes(group, "fast")).catch(() => ({ got, granted: false })));
  const out: Record<string, MarketQuote> = {};
  let stale = 0;
  for (const t of new Set(tickers)) { const hit = all[t]; if (hit?.value) { out[t] = hit.value; if (!hit.fresh) stale++; } }
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
async function resolveFresh(id: string, tier: Tier = "user"): Promise<Board> {
  if ((unresolved.get(id) ?? 0) > Date.now()) throw new Error(`unresolved ${id}`);
  const entry = MARKET_SYMBOLS[id], known = resolvedVariant.get(id);
  const tried: string[] = [];
  let refused = false;
  const attempt = async (variant: Variant): Promise<Board | null> => {
    const { symbol = id, ...extra } = variant;
    try {
      const quote = parseQuote(await call("quote", { symbol, ...extra, prepost: "true" }, tier), symbol);
      if (!quote) throw new Error("no quote");
      resolvedVariant.set(id, variant);
      return { variant, quote };
    } catch (error) { if (isBudgetError(error)) refused = true; tried.push(`${JSON.stringify(variant)}: ${error instanceof Error ? error.message : "failed"}`); return null; }
  };
  const order = known ? [known, ...entry.variants.filter(v => v !== known)] : entry.variants;
  for (const variant of order) { if (refused) break; const got = await attempt(variant); if (got) return got; }
  if (entry.search && !refused) {
    try {
      const body = await call("symbol_search", { symbol: entry.search, outputsize: "10" }, tier) as { data?: { symbol?: unknown; instrument_name?: unknown; exchange?: unknown; instrument_type?: unknown }[] };
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
/** One bar series from the shared copy of its slot (one provider credit for everyone), else the last good copy. `fetch` false: copies only;
 * a function: asked only when the provider would really be read (no fresh copy), and false keeps the last good copy. */
async function bars(ticker: string, interval: string, size: number, options: { slotMs?: number; fetch?: boolean | (() => boolean); tier?: Tier } = {}): Promise<Bar[]> {
  return (await barsEntry(ticker, interval, size, options)).value;
}
/** The same read, with the copy's time and whether it is this slot's (fresh) or a last good copy. */
async function barsEntry(ticker: string, interval: string, size: number, { slotMs, fetch = true, tier = "user" }: { slotMs?: number; fetch?: boolean | (() => boolean); tier?: Tier } = {}): Promise<Result<Bar[]>> {
  const spec: ReadSpec = { name: "md-bars-v1", slotMs: slotMs ?? barSlotMs(ticker, interval, Date.now()), staleMs: STALE_LIMIT_MS };
  const got = await sharedReader.read<Bar[]>(spec, `${ticker}|${interval}|${size}`, fetch ? async () => {
    if (typeof fetch === "function" && !fetch()) throw new Error("no-read-allowance");
    const base = { interval, outputsize: String(size), order: "desc" };
    const target = MARKET_SYMBOLS[ticker] ? await marketTarget(ticker) : null;
    return parseBars(target ? await call("time_series", { symbol: target.symbol, ...base, ...intradayParams(ticker, interval), ...target.extra }, tier)
      : await call("time_series", { symbol: ticker, ...base, ...intradayParams(ticker, interval) }, tier));
  } : null);
  if (!got) throw new Error("bars-unavailable");
  return got;
}
/** Every bar fetched for a range (the drawn ones and the ones before them). Pre-market and after-hours bars are included for 1D / 1W. */
const readAll = (ticker: string, range: ChartRange, options?: { slotMs?: number; fetch?: boolean | (() => boolean) }) => { const spec = chartSpec(range); return bars(ticker, spec.interval, spec.size, options); };
/** The bars of one board period (see market-board-periods.ts) and the bars before them. Intraday candles are shared a minute (the live price
 * comes from the quote), daily and longer at least ten minutes. */
export async function loadPeriodSet(ticker: string, period: BoardPeriod): Promise<{ bars: Bar[]; before: Bar[] }> {
  const series = periodSeries(period);
  return shapePeriod(period, await bars(ticker, series.interval, series.size, isIntradayPeriod(period) ? {} : { slotMs: Math.max(10 * 60_000, barSlotMs(ticker, series.interval, Date.now())) }));
}

/** 銘柄検索「今日の注目」's daily bars (lib/research/search-focus-server.ts), read by the minute job the way refreshBoardSnapshot reads its
 * charts: the shared bar copy members' reads use, on the "warm" tier; `spend` is called only when the provider is really asked. */
export function loadSnapshotDailyBars(ticker: string, size: number, spend: () => void): Promise<Result<Bar[]>> {
  return barsEntry(ticker, "1day", size, { fetch: () => { spend(); return true; }, tier: "warm" });
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
      // Owner, Nov 25 (NVDA, TSM, AMD without a chart): the allowance is spent only by a real provider read, not by a sparkline already shared
      // by everyone, so a longer list is not left without charts after its first eight rows.
      const all = await readAll(q.ticker, "1d", { slotMs: 5 * 60_000, fetch: () => allowance-- > 0 });
      out[q.ticker] = all.filter(bar => { const iso = easternToIso(bar.at); return iso !== "" && days.has(easternDay.format(Date.parse(iso))); });
    } catch { out[q.ticker] = []; }
  }));
  return out;
}

/** Statistics: the comparison's daily copy of every US-listed company first (no credit); the provider (50 credits) only for one it lacks. */
async function statisticsFor(ticker: string, tier: Tier = "user", spend?: () => void): Promise<unknown> {
  const stored = await cachedStatistics(ticker).catch(() => null);
  if (stored) return stored.payload;
  spend?.();
  return call("statistics", { symbol: ticker }, tier);
}
/** Production QA, Nov 25 (NVDA, AMD and TSM showed — for EPS, market cap, dividend yield and next earnings while MU did not): the four facts
 * were one cached answer, so a refused 20-credit earnings read threw away NVDA's statistics although the comparison had stored them for
 * free, and a failed or unparseable statistics read was cached for six hours as an empty answer. The statistics and the earnings date are
 * now read separately through the shared reader: a fresh copy for six hours (a day for the date), one read for everyone, and when a read is
 * refused, fails or comes back empty, the last good copy. An empty answer is never stored as a valid one. */
const STATS_SPEC: ReadSpec = { name: "md-facts-stats-v2", slotMs: 6 * 3600_000, staleMs: 14 * 86_400_000, durable: true };
const EARNINGS_SPEC: ReadSpec = { name: "md-facts-next-earnings-v2", slotMs: 24 * 3600_000, staleMs: 7 * 86_400_000, durable: true };
/** A ticker whose provider read just failed is not asked again by this instance for a while (each statistics read costs 50 credits). */
const FACTS_RETRY_MS = 10 * 60_000;
const factsFailed = new Map<string, number>();
const failedLately = (key: string) => Date.now() - (factsFailed.get(key) ?? 0) < FACTS_RETRY_MS;
const noteFailure = (key: string) => { factsFailed.set(key, Date.now()); if (factsFailed.size > 5_000) factsFailed.delete(factsFailed.keys().next().value!); };
async function readStatFacts(ticker: string, tier: Tier = "user", spend?: () => void): Promise<StatFacts> {
  const parsed = parseStatistics(await statisticsFor(ticker, tier, spend), ticker);
  if (!hasStatFacts(parsed)) throw new Error("facts-empty");
  return parsed;
}
async function readNextEarnings(ticker: string, today: string, tier: Tier = "user"): Promise<string | null> {
  // No period=next: Twelve Data answers it with a 404 ("No earning were found") whenever it lists no future date, so every stock page paid
  // 20 credits for an error. The plain list is a valid answer; a future date in it is the next one, none is a valid "not known yet".
  return parseNextEarnings(await call("earnings", { symbol: ticker }, tier), today);
}
/** EPS, market cap, dividend yield and the next earnings date. The site's own calendar wins over the provider's. A failed, refused or empty
 * read is never stored; the last good copy stands in for it, and members asking for the same company at once share one read.
 * 監視22銘柄 (lib/research/monitored-facts.ts): the minute job keeps their copies (refreshMonitoredFacts), so a member's request only reads them
 * and never asks the provider: 22 cards' reads at once were refused and starved the warm job (production, Nov 26). */
export async function loadMarketFacts(ticker: string): Promise<MarketFacts & { complete: boolean }> {
  const today = new Date().toISOString().slice(0, 10);
  const own = nextEarningsFromSite(ticker, [...calendarEvents, ...dateOnlyEarnings], today);
  const scheduled = isMonitoredFactsTicker(ticker);
  const guarded = <T>(name: string, work: () => Promise<T>) => scheduled || failedLately(`${name}:${ticker}`) ? null
    : async () => { try { return await work(); } catch (error) { noteFailure(`${name}:${ticker}`); throw error; } };
  const [stats, earnings] = await Promise.all([
    sharedReader.read<StatFacts>(STATS_SPEC, ticker, guarded("stats", () => readStatFacts(ticker))).catch(() => null),
    own ? Promise.resolve(null) : sharedReader.read<string | null>(EARNINGS_SPEC, ticker, guarded("earnings", () => readNextEarnings(ticker, today))).catch(() => null),
  ]);
  const value = stats && hasStatFacts(stats.value) ? stats.value : null;
  // A stored date that has passed is not "next" any more.
  const provider = earnings?.value && earnings.value >= today ? earnings.value : null;
  return { eps: value?.eps ?? null, marketCap: value?.marketCap ?? null, dividendYield: value?.dividendYield ?? null, nextEarnings: own ?? provider,
    nextEarningsKnown: own !== null || earnings !== null, complete: value !== null };
}

let monitoredRun: Promise<{ spent: number; read: number; failed: number }> | null = null;
/** One minute of the 監視22銘柄 facts (from app/api/research/compare/warm, before the comparison, which yields the credits spent here): the
 * statistics of at most MONITORED_STATS_PER_MINUTE companies without a current copy (none when the comparison's daily copy is stored) and the
 * earnings list of at most MONITORED_EARNINGS_PER_MINUTE, on the warm tier through the allocator. A refusal costs nothing and the company is
 * simply due again next minute; a failed read is not asked again by this instance for FACTS_RETRY_MS. `spent`: credits granted. */
export function refreshMonitoredFacts(now = Date.now()): Promise<{ spent: number; read: number; failed: number }> {
  return monitoredRun ??= (async () => {
    const today = new Date(now).toISOString().slice(0, 10);
    const events = [...calendarEvents, ...dateOnlyEarnings];
    const state = (got: Result<unknown> | null): CopyState => got ? { at: got.at, fresh: got.fresh } : null;
    const tickers = MONITORED_FACTS_TICKERS;
    const [stats, earnings] = await Promise.all([
      Promise.all(tickers.map(async t => [t, state(await sharedReader.read<StatFacts>(STATS_SPEC, t, null).catch(() => null))] as const)),
      Promise.all(tickers.filter(t => !nextEarningsFromSite(t, events, today))
        .map(async t => [t, state(await sharedReader.read<string | null>(EARNINGS_SPEC, t, null).catch(() => null))] as const)),
    ]);
    let spent = 0, read = 0, failed = 0;
    const run = async <T>(spec: ReadSpec, ticker: string, name: string, cost: number, work: (spend: () => void) => Promise<T>) => {
      let asked = false;
      const got = await sharedReader.read<T>(spec, ticker, async () => {
        try { return await work(() => { asked = true; spent += cost; }); }
        catch (error) { if (isBudgetError(error)) { if (asked) spent -= cost; } else noteFailure(`${name}:${ticker}`); throw error; }
      }).catch(() => null);
      if (got?.fresh) read++; else failed++;
    };
    await Promise.all([
      ...factsDue(stats, MONITORED_STATS_PER_MINUTE, t => failedLately(`stats:${t}`))
        .map(t => run<StatFacts>(STATS_SPEC, t, "stats", 50, spend => readStatFacts(t, "warm", spend))),
      ...factsDue(earnings, MONITORED_EARNINGS_PER_MINUTE, t => failedLately(`earnings:${t}`))
        .map(t => run<string | null>(EARNINGS_SPEC, t, "earnings", 20, spend => { spend(); return readNextEarnings(t, today, "warm"); })),
    ]);
    return { spent, read, failed };
  })().finally(() => { monitoredRun = null; });
}

/** Owner, Nov 11: the index symbols (DJI / NDX / SPX) answered with other securities on this plan (a $21 and a $0.1 quote), so the
 * panel reads the three ETFs that track them. The percentage is the ETF's and the column says so; never mix in an unchecked symbol. */
/** The price board: one quote per requested symbol (those that cannot be read are simply absent, and logged). */
export type BoardQuote = { id: string; price: number; change: number | null; percentChange: number | null; currency: string; asOf: string; marketOpen: boolean; extended: MarketQuote["extended"]; high: number | null; low: number | null; open: number | null; volume: number | null };
const boardQuote = (id: string, quote: MarketQuote): BoardQuote => ({ id, price: quote.price, change: quote.change, percentChange: quote.percentChange, currency: quote.currency, asOf: quote.asOf, marketOpen: quote.marketOpen, extended: quote.extended, high: quote.high, low: quote.low, open: quote.open, volume: quote.volume });
export async function loadBoard(ids: string[], fast = false): Promise<BoardQuote[]> {
  const out: BoardQuote[] = [];
  await Promise.all(ids.filter(isMarketChartSymbol).map(async id => {
    const quote = (await boardEntry(id, fast))?.quote;
    if (quote) out.push(boardQuote(id, quote));
  }));
  return ids.flatMap(id => out.filter(item => item.id === id));
}

/** マーケット「レバETF」(owner, Nov 25): the funds and the stocks under them (lib/research/leveraged-etfs.ts, 89 symbols) in ONE shared snapshot.
 * Owner, Nov 25: the list must show every row at once from the first load. Members' requests only read the snapshot; the site's minute job
 * (refreshLeveragedSnapshot, from app/api/research/compare/warm, which the Railway monitor calls once a minute) reads the symbols that are due
 * in 12-symbol batches through the allocator's lease and writes the snapshot again every minute, so the newest copy is always in the current
 * or the previous minute's slot for every instance. */
const LEVERAGED_FUNDS = new Set(LEVERAGED_ETFS.map(item => item.etf));
const LEVERAGED_SNAPSHOT_SPEC: ReadSpec = { name: "md-lev-snap-v1", slotMs: 60_000, staleMs: STALE_LIMIT_MS };
type LevSnapshot = LeveragedSnapshot<MarketQuote>;
async function currentLeveragedSnapshot(): Promise<LevSnapshot | null> {
  return (await sharedReader.read<LevSnapshot>(LEVERAGED_SNAPSHOT_SPEC, "all", null).catch(() => null))?.value ?? null;
}
let leveragedRun: Promise<{ spent: number; read: number; failed: number }> | null = null;
/** One minute of the background refresh. Returns the credits asked for (spent), the symbols stored and those whose batch was refused or failed. */
export function refreshLeveragedSnapshot(now = Date.now()): Promise<{ spent: number; read: number; failed: number }> {
  return leveragedRun ??= (async () => {
    const old = await currentLeveragedSnapshot();
    const quotes: LevSnapshot["quotes"] = { ...(old?.quotes ?? {}) };
    const ages = Object.fromEntries(Object.entries(quotes).map(([symbol, entry]) => [symbol, now - entry.at]));
    const due = leveragedDue(ages, stocksTrading(now));
    let spent = 0, read = 0, failed = 0;
    const groups: string[][] = [];
    for (let i = 0; i < due.length; i += 12) groups.push(due.slice(i, i + 12));
    await Promise.all(groups.map(async group => {
      try {
        spent += group.length;
        const values = await fetchQuotes(group), at = Date.now();
        for (const symbol of group) { const value = values.get(symbol); if (value) { quotes[symbol] = { value, at }; read++; } }
      } catch (error) { failed += group.length; if (isBudgetError(error)) spent -= group.length; }
    }));
    if (Object.keys(quotes).length) await sharedReader.save(LEVERAGED_SNAPSHOT_SPEC, "all", { value: { at: Date.now(), quotes }, at: Date.now() });
    return { spent, read, failed };
  })().finally(() => { leveragedRun = null; });
}
/** The list's quotes from the snapshot, and the time of its oldest fund quote. No snapshot at all (a new deployment before the minute job has
 * run once): this request fills it once (shared by concurrent requests), so the very first visitor still gets the whole list. */
export async function loadLeveragedSnapshot(): Promise<{ quotes: Record<string, MarketQuote>; at: number | null; filled: boolean }> {
  let snapshot = await currentLeveragedSnapshot(), filled = false;
  if (!snapshot) { await refreshLeveragedSnapshot(); snapshot = await currentLeveragedSnapshot(); filled = true; }
  const quotes: Record<string, MarketQuote> = {};
  let at: number | null = null;
  for (const [symbol, entry] of Object.entries(snapshot?.quotes ?? {})) {
    quotes[symbol] = entry.value;
    if (LEVERAGED_FUNDS.has(symbol)) at = at === null ? entry.at : Math.min(at, entry.at);
  }
  return { quotes, at, filled };
}

/** マーケット: every tab's cards and each tab's first chart in ONE shared snapshot (lib/research/market-snapshot.ts; owner, Nov 25: a tab not
 * opened yet took seconds). The minute job (refreshBoardSnapshot, from app/api/research/compare/warm) reads what is due on the "warm" tier,
 * through the same shared copies members' reads use — a copy someone already read this slot costs nothing — and writes the snapshot again.
 * Members only read it (loadBoardSnapshot); only a new deployment's very first visitor fills it once. */
const BOARD_SNAPSHOT_SPEC: ReadSpec = { name: "md-board-snap-v1", slotMs: 60_000, staleMs: STALE_LIMIT_MS };
type BoardSnapshot = { at: number; entries: Record<string, { at: number; quote?: BoardQuote; bars?: Bar[] }> };
async function currentBoardSnapshot(): Promise<BoardSnapshot | null> {
  return (await sharedReader.read<BoardSnapshot>(BOARD_SNAPSHOT_SPEC, "all", null).catch(() => null))?.value ?? null;
}
let boardRun: Promise<{ spent: number; read: number; failed: number }> | null = null;
/** One minute of the background refresh: the credits asked of the provider (spent), the entries stored and those refused or failed. */
export function refreshBoardSnapshot(now = Date.now()): Promise<{ spent: number; read: number; failed: number }> {
  return boardRun ??= (async () => {
    const old = await currentBoardSnapshot();
    const entries: BoardSnapshot["entries"] = { ...(old?.entries ?? {}) };
    const due = boardDue(Object.fromEntries(Object.entries(entries).map(([key, entry]) => [key, now - entry.at])), stocksTrading(now));
    const series = periodSeries(BOARD_SNAPSHOT_PERIOD);
    let spent = 0, read = 0, failed = 0;
    await Promise.all(due.map(async job => {
      try {
        if (job.kind === "quote") {
          const got = await sharedReader.read<Board>(boardSpec(false), job.id, () => { spent++; return resolveFresh(job.id, "warm"); });
          if (!got?.fresh) throw new Error("not-read");
          resolvedVariant.set(job.id, got.value.variant);
          entries[boardJobKey(job)] = { at: got.at, quote: boardQuote(job.id, got.value.quote) };
        } else {
          const at = Date.now();
          const value = await bars(job.id, series.interval, series.size, { fetch: () => { spent++; return true; }, tier: "warm" });
          if (!value.length) throw new Error("no-bars");
          entries[boardJobKey(job)] = { at, bars: value };
        }
        read++;
      } catch { failed++; }
    }));
    if (Object.keys(entries).length) await sharedReader.save(BOARD_SNAPSHOT_SPEC, "all", { value: { at: Date.now(), entries }, at: Date.now() });
    return { spent, read, failed };
  })().finally(() => { boardRun = null; });
}
/** Every card's quote and every tab's first chart (shaped as the chart answer is), from the snapshot. `at`: its oldest entry. */
export type BoardSnapshotView = { quotes: Record<string, BoardQuote>; charts: Record<string, { bars: Bar[]; before: Bar[] }>; at: number | null };
export async function loadBoardSnapshot(): Promise<BoardSnapshotView & { filled: boolean }> {
  let snapshot = await currentBoardSnapshot(), filled = false;
  if (!snapshot) { await refreshBoardSnapshot(); snapshot = await currentBoardSnapshot(); filled = true; }
  return { ...shapeBoardSnapshot(snapshot), filled };
}
/** The page's first paint (app/research/market/page.tsx): the shared snapshot as it is, or null. Never asks the provider, never fills it. */
export async function peekBoardSnapshot(): Promise<BoardSnapshotView | null> {
  if (!marketDataConfigured()) return null;
  const snapshot = await currentBoardSnapshot();
  return snapshot ? shapeBoardSnapshot(snapshot) : null;
}
function shapeBoardSnapshot(snapshot: BoardSnapshot | null): BoardSnapshotView {
  const quotes: Record<string, BoardQuote> = {}, charts: Record<string, { bars: Bar[]; before: Bar[] }> = {};
  let at: number | null = null;
  for (const entry of Object.values(snapshot?.entries ?? {})) {
    if (entry.quote) quotes[entry.quote.id] = entry.quote;
    at = at === null ? entry.at : Math.min(at, entry.at);
  }
  for (const [key, entry] of Object.entries(snapshot?.entries ?? {})) {
    if (!key.startsWith("chart:") || !entry.bars?.length) continue;
    const shaped = shapePeriod(BOARD_SNAPSHOT_PERIOD, entry.bars);
    if (shaped.bars.length) charts[key.slice("chart:".length)] = shaped;
  }
  return { quotes, charts, at };
}
