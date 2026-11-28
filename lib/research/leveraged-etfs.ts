import { marketPhase } from "./us-market-session.ts";
import { displayClock, formatDisplay, zoneLabel } from "./display-time.ts";
/** マーケット「レバETF」tab (owner, Nov 25): long 2x / 3x ETFs on the stocks Tech Phase follows. Every ticker below was checked against the
 * provider on Nov 25, 2026 (Twelve Data's own fund name says "2X Long <underlying>" / "Bull 2X" / "UltraPro"); one that the provider cannot serve is
 * simply absent from the screen. Only long (bull) funds: no inverse ETF is listed.
 * - Owner's list: MUU … SOXL. AAOI's 2x long: AAOX (Tradr; AAOG from Leverage Shares also exists, but trades a fraction of AAOX's volume).
 *   SNDU is the T-REX 2X Long SNDK fund (checked). RAM is the Roundhill T-REX 2X Long DRAM fund; the provider still names it after the
 *   old SPAC that had the ticker (Aries I Acquisition), so the screen never shows the provider's name.
 * - Then every one of the 22 tracked stocks (監視22銘柄) and the Theme Ranking stocks that have a long 2x fund (none of them has a 3x one). */
export type LeveragedEtf = { etf: string; underlying: string; leverage: 2 | 3 };
const two = (etf: string, underlying: string): LeveragedEtf => ({ etf, underlying, leverage: 2 });
const three = (etf: string, underlying: string): LeveragedEtf => ({ etf, underlying, leverage: 3 });
export const LEVERAGED_ETFS: readonly LeveragedEtf[] = [
  // The owner's list (Nov 25).
  two("MUU", "MU"), two("SKHL", "SKHY"), two("AMUU", "AMD"), two("NVDL", "NVDA"), two("TSLL", "TSLA"), two("PTIR", "PLTR"), two("MSTU", "MSTR"),
  two("CONL", "COIN"), two("AVL", "AVGO"), two("TSMX", "TSM"), two("QLD", "QQQ"), two("NBIL", "NBIS"), two("SNDU", "SNDK"), two("RAM", "DRAM"),
  two("AAOX", "AAOI"), three("TQQQ", "QQQ"), three("SOXL", "SOXX"),
  // The rest of the 22 tracked stocks.
  two("ARMG", "ARM"), two("ASMG", "ASML"), two("MVLL", "MRVL"), two("ANEL", "ANET"), two("CRDU", "CRDO"), two("CWVX", "CRWV"), two("VRTL", "VRT"),
  two("GEVX", "GEV"), two("MSFU", "MSFT"), two("BEX", "BE"), two("GGLL", "GOOGL"), two("LITX", "LITE"), two("LABX", "ALAB"),
  // Theme Ranking stocks.
  two("IONL", "IONQ"), two("RGTX", "RGTI"), two("QBTX", "QBTS"), two("OKLL", "OKLO"), two("RKLX", "RKLB"), two("SMCX", "SMCI"), two("ORCX", "ORCL"),
  two("CRWL", "CRWD"), two("ASTX", "ASTS"), two("LLYX", "LLY"), two("CEGX", "CEG"), two("SMU", "SMR"), two("COHX", "COHR"), two("IREX", "IREN"),
  two("APLX", "APLD"),
];
/** Every symbol the tab reads, once each: the funds first, then the stocks under them. A cold read is spread over several requests (at most 48
 * symbols each, every 12-symbol batch leased separately), so the funds — the rows themselves — come first and a stock's change fills in after
 * (Nov 25: interleaved, a first answer could hold the stocks but not their funds and show nothing). */
export const LEVERAGED_SYMBOLS: readonly string[] = [...new Set([...LEVERAGED_ETFS.map(item => item.etf), ...LEVERAGED_ETFS.map(item => item.underlying)])];

export type LeveragedQuote = { price: number; percentChange: number | null; volume: number | null;
  extended?: { price: number; percentChange: number | null; session: "pre" | "post"; live?: boolean } | null;
  /** The provider's session date (YYYY-MM-DD, its `datetime`) and the last trade's time (ISO, its `last_quote_at`), when known. */
  session?: string | null; lastTradeAt?: string | null };
/** "lag": during the regular session the fund has not traded for LEVERAGED_LAG_MS while its stock traded later (owner, Nov 27: CRWL, 1,687
 * shares); the figures are real and stay, the row goes below the fresh ones. */
export type LeveragedStale = "lag" | null;
export type LeveragedRow = LeveragedEtf & {
  price: number; percentChange: number | null; volume: number | null; underlyingChange: number | null;
  /** The pre-market / after-hours price, only while that session is the one under way. */
  extended: { price: number; percentChange: number; session: "pre" | "post" } | null;
  session: string | null; lastTradeAt: string | null; underlyingSession: string | null; underlyingLastTradeAt: string | null;
  stale: LeveragedStale;
};
export const LEVERAGED_LAG_MS = 30 * 60_000;

/** Thinly traded funds are left out of the list (owner, Nov 27: COHX, CRWL). A fund is shown only while its average daily volume over the last
 * LEVERAGED_ADV_DAYS settled sessions is at least LEVERAGED_MIN_ADV shares. The site's minute job reads each fund's daily bars once per settled
 * session (lib/research/market-data.ts refreshLeveragedSnapshot; ~45 credits a day, never per member).
 * Why 1,000,000 (owner, Nov 27): measured on Twelve Data's daily bars, 20 sessions to Nov 25, almost every fund trades far above 100k, so 100k
 * left nothing out. At 1M a day the funds under it were exactly LEVERAGED_KNOWN_THIN below (ARMG 977k … ASMG 33k); AVL (1.009M) stays.
 * A fund not measured yet (a new deployment's first minutes, or too few bars) is left out only if it is in LEVERAGED_KNOWN_THIN, so the first
 * minutes after a deploy show the same list as the measured one. COHX (above the line) is left out on Nov 27 by the session rule, not by volume. */
export const LEVERAGED_MIN_ADV = 1_000_000, LEVERAGED_ADV_DAYS = 20;
/** The funds under LEVERAGED_MIN_ADV on Nov 25's 20-session average (shares a day): ARMG 977k, QBTX 808k, TSMX 775k, VRTL 321k, GEVX 255k,
 * LLYX 243k, SMU 181k, AMUU 179k, CRWL 145k, CEGX 92k, ANEL 87k, ASMG 33k. Used only until a fund is measured. */
export const LEVERAGED_KNOWN_THIN: ReadonlySet<string> = new Set(["ARMG", "QBTX", "TSMX", "VRTL", "GEVX", "LLYX", "SMU", "AMUU", "CRWL", "CEGX", "ANEL", "ASMG"]);
/** The average volume of the last LEVERAGED_ADV_DAYS daily bars dated on or before `session` (oldest-first bars, as parseBars returns them).
 * Null with fewer than half that many bars that carry a volume. */
export function averageDailyVolume(bars: readonly { at: string; volume: number | null }[], session: string): number | null {
  const volumes = bars.filter(bar => bar.at.slice(0, 10) <= session && bar.volume !== null && Number.isFinite(bar.volume) && bar.volume >= 0)
    .slice(-LEVERAGED_ADV_DAYS).map(bar => bar.volume!);
  return volumes.length * 2 < LEVERAGED_ADV_DAYS ? null : volumes.reduce((sum, value) => sum + value, 0) / volumes.length;
}
/** `adv`: each fund's measured average (null / absent: not measured, then LEVERAGED_KNOWN_THIN decides). */
export const leveragedThin = (adv: Record<string, number | null | undefined>, etf: string) => { const value = adv[etf]; return typeof value === "number" && Number.isFinite(value) ? value < LEVERAGED_MIN_ADV : LEVERAGED_KNOWN_THIN.has(etf); };

const easternDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const day = (value: string | null | undefined) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
const time = (value: string | null | undefined) => { const at = typeof value === "string" ? Date.parse(value) : NaN; return Number.isFinite(at) ? at : null; };
/** One row per fund the provider answered for that trades enough (LEVERAGED_MIN_ADV). The stock's own day change comes from its own quote (never
 * derived from the fund's). A row whose fund or stock quote is for an older session than the current one (from the regular open to the end of
 * after-hours: today, New York) or than the other side's is left out (owner, Nov 27: COHX dated 11/25 beside COHR's 11/27 had shown 11/25's
 * change as today's). Before the open the two sides are not compared (a pre-market print may move one of them first). */
export function leveragedRows(quotes: Record<string, LeveragedQuote | undefined>, now = Date.now(), adv: Record<string, number | null | undefined> = {}): LeveragedRow[] {
  const phase = marketPhase(new Date(now)), today = phase === "regular" || phase === "post" ? easternDate.format(now) : null;
  return LEVERAGED_ETFS.flatMap(item => {
    const q = quotes[item.etf], u = quotes[item.underlying];
    if (!q || !Number.isFinite(q.price) || q.price <= 0 || leveragedThin(adv, item.etf)) return [];
    const session = day(q.session), underlyingSession = day(u?.session);
    const old = (own: string | null, other: string | null) => own !== null && ((today !== null && own < today) || (phase !== "pre" && other !== null && own < other));
    if (old(session, underlyingSession) || old(underlyingSession, session)) return [];
    const ext = q.extended;
    const last = time(q.lastTradeAt), stockLast = time(u?.lastTradeAt);
    const lag = phase === "regular" && last !== null && stockLast !== null && now - last > LEVERAGED_LAG_MS && stockLast > last;
    return [{ ...item, price: q.price, percentChange: q.percentChange ?? null, volume: q.volume ?? null, underlyingChange: u?.percentChange ?? null,
      extended: ext && ext.live && Number.isFinite(ext.price) && ext.price > 0 && ext.percentChange !== null && Number.isFinite(ext.percentChange) ? { price: ext.price, percentChange: ext.percentChange, session: ext.session } : null,
      session, lastTradeAt: last === null ? null : new Date(last).toISOString(), underlyingSession, underlyingLastTradeAt: stockLast === null ? null : new Date(stockLast).toISOString(),
      stale: lag ? "lag" as const : null }];
  });
}

export type LeveragedSort = "gainers" | "losers" | "volume";
export const LEVERAGED_SORTS: readonly LeveragedSort[] = ["gainers", "losers", "volume"];
/** 上昇率 (largest rise first), 下落率 (largest fall first), 出来高 (most shares first). A row without the figure goes last; ties keep the list's order.
 * Whatever the order, fresh rows come first, then those whose fund lags its stock ("lag"). */
export function sortLeveraged(rows: readonly LeveragedRow[], sort: LeveragedSort): LeveragedRow[] {
  const value = (row: LeveragedRow) => sort === "volume" ? row.volume : row.percentChange;
  const sign = sort === "losers" ? 1 : -1;
  const rank = (row: LeveragedRow) => row.stale === "lag" ? 1 : 0;
  return rows.map((row, index) => ({ row, index })).sort((a, b) => {
    const tier = rank(a.row) - rank(b.row);
    if (tier) return tier;
    const x = value(a.row), y = value(b.row);
    if (x === null || !Number.isFinite(x)) return y === null || !Number.isFinite(y) ? a.index - b.index : 1;
    if (y === null || !Number.isFinite(y)) return -1;
    return (x - y) * sign || a.index - b.index;
  }).map(item => item.row);
}

/** Prices: three decimals under $100 as the sheet shows them (4.100, 13.330), two above. */
export const leveragedPrice = (value: number) => value.toFixed(Math.abs(value) < 100 ? 3 : 2);
export const leveragedPercent = (value: number, digits = 2) => `${value > 0 ? "+" : value < 0 ? "-" : ""}${Math.abs(value).toFixed(digits)}%`;

/** The shared snapshot (owner, Nov 25: "all rows at once from the first load"). The site's minute job (app/api/research/compare/warm, run
 * every minute by the Railway monitor) refreshes it in the background through the allocator; a member's request only reads it and never asks the
 * provider. Every symbol keeps its own time, so a refused or failed batch leaves that symbol's last good quote in place. */
export type LeveragedSnapshot<Q> = { at: number; quotes: Record<string, { value: Q; at: number }>;
  /** Each fund's average daily volume (LEVERAGED_ADV_DAYS sessions; null: too few bars), the settled session it was measured for and the last
   * attempt. Absent in snapshots written before Nov 27. */
  liquidity?: Record<string, { adv: number | null; session: string | null; tried: number }> };
/** Funds whose average volume is due: never measured, or measured for an older settled session and not tried in the last 20 minutes;
 * at most LEVERAGED_ADV_PER_RUN a minute. */
export const LEVERAGED_ADV_PER_RUN = 12;
export function leveragedAdvDue(liquidity: LeveragedSnapshot<unknown>["liquidity"] = {}, session: string, now: number, funds: readonly string[] = LEVERAGED_ETFS.map(item => item.etf)): string[] {
  return funds.filter(etf => { const entry = liquidity[etf]; return !entry || (entry.session !== session && now - entry.tried >= 20 * 60_000); }).slice(0, LEVERAGED_ADV_PER_RUN);
}
/** A symbol is read again once this old: every ~2 minutes while U.S. stocks trade (04:00–20:00 New York, pre-market and after-hours included),
 * every 15 minutes otherwise. At most LEVERAGED_PER_RUN symbols a minute (four 12-symbol batches), oldest first, so the 89 symbols spread over two
 * minutes (~45 credits a minute) instead of 89 in one. A symbol never read yet is always read at once (the first fill is the whole list). */
export const LEVERAGED_TRADING_AGE_MS = 90_000, LEVERAGED_CLOSED_AGE_MS = 15 * 60_000, LEVERAGED_PER_RUN = 48;
export function leveragedDue(ages: Record<string, number | undefined>, trading: boolean, symbols: readonly string[] = LEVERAGED_SYMBOLS): string[] {
  const never = symbols.filter(symbol => ages[symbol] === undefined);
  const limit = trading ? LEVERAGED_TRADING_AGE_MS : LEVERAGED_CLOSED_AGE_MS;
  const old = symbols.filter(symbol => ages[symbol] !== undefined && ages[symbol]! >= limit).sort((a, b) => ages[b]! - ages[a]!);
  return [...never, ...old.slice(0, Math.max(0, LEVERAGED_PER_RUN - never.length))];
}
/** Credits a day (one credit per symbol a read): 16 trading hours at one read per symbol every two minutes, 8 closed hours at one per 15 minutes. */
export function leveragedCreditsPerDay(symbols = LEVERAGED_SYMBOLS.length) {
  const weekday = symbols * (16 * 60 / 2 + 8 * 60 / 15), weekend = symbols * (24 * 60 / 15);
  return { weekday, weekend, perTradingMinute: symbols / 2, peakMinute: LEVERAGED_PER_RUN };
}
/** The time beside the list once the snapshot is older than this (the refresh stopped): the full last list stays, with 「〇〇時点」. */
export const LEVERAGED_STALE_MS = 5 * 60_000;

/** What the レバETF list shows while it reads (owner, Nov 25: "読み込み中…" must never stay forever). `rows` null: nothing answered yet.
 * Each answer is the whole list; a failed read keeps the list on the screen. 「データを取得できませんでした」 only when an answer holds no fund,
 * or LEVERAGED_GIVE_UP reads in a row (errors and timeouts included) brought none. */
export type LeveragedView = { rows: LeveragedRow[] | null; at: number | null; failed: boolean; empty: number };
export const LEVERAGED_GIVE_UP = 3;
export const LEVERAGED_START: LeveragedView = { rows: null, at: null, failed: false, empty: 0 };
/** `answer` null: the request failed or timed out. */
export function nextLeveragedView(view: LeveragedView, answer: { rows: LeveragedRow[]; at: number | null } | null): LeveragedView {
  if (answer?.rows.length) return { rows: answer.rows, at: answer.at, failed: false, empty: 0 };
  if (view.rows?.length) return view;
  const empty = view.empty + 1, done = view.failed || answer !== null || empty >= LEVERAGED_GIVE_UP;
  return { rows: done ? [] : null, at: null, failed: done, empty };
}

/** 「11/25 19:12 JST 時点」 / "As of 11/25 05:12 ET". */
export function leveragedAsOf(at: number, ja: boolean) {
  const lang = ja ? "ja" : "en", day = formatDisplay(at, lang, { month: "numeric", day: "numeric" });
  return ja ? `${day} ${displayClock(at, lang)} ${zoneLabel(lang)} 時点` : `As of ${day} ${displayClock(at, lang)} ${zoneLabel(lang)}`;
}
