import type { FavoriteQuote } from "./favorite-lists.ts";
import { twelveNumber } from "./twelve-data-values.ts";

/** Pure helpers for the Twelve Data price display (cards, detail page, indices). No network, no key. */
type Row = Record<string, unknown>;
const obj = (x: unknown): Row => x !== null && typeof x === "object" && !Array.isArray(x) ? x as Row : {};
const n = twelveNumber;

export type MarketQuote = {
  ticker: string; name: string; exchange: string; currency: string;
  price: number; change: number | null; percentChange: number | null; previousClose: number | null;
  open: number | null; high: number | null; low: number | null; volume: number | null;
  week52Low: number | null; week52High: number | null; asOf: string; marketOpen: boolean;
};
export type Bar = { at: string; open: number; high: number; low: number; close: number };
export type ChartRange = "1d" | "1w" | "1m" | "3m" | "6m" | "ytd" | "1y" | "3y" | "5y";
export const CHART_RANGES: ChartRange[] = ["1d", "1w", "1m", "3m", "6m", "ytd", "1y", "3y", "5y"];
export const isChartRange = (x: unknown): x is ChartRange => typeof x === "string" && (CHART_RANGES as string[]).includes(x);
export const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

/** One /quote answer for one symbol. Rejects an error body, a different symbol and non-positive prices. */
export function parseQuote(raw: unknown, ticker: string): MarketQuote | null {
  const q = obj(raw);
  if (q.status === "error" || (typeof q.symbol === "string" && q.symbol.toUpperCase() !== ticker.toUpperCase())) return null;
  const price = n(q.close);
  // `timestamp` is the OPENING time of the day's bar; `last_quote_at` is the last quote (owner screenshot, Nov 11: "23:30 JST" after the close).
  const seconds = n(q.last_quote_at) ?? n(q.timestamp);
  if (price === null || price <= 0) return null;
  const at = seconds !== null && seconds > 0 ? seconds * 1000 : Date.parse(`${String(q.datetime)}T20:00:00Z`);
  if (!Number.isFinite(at)) return null;
  const year = obj(q.fifty_two_week);
  const positive = (x: unknown) => { const v = n(x); return v !== null && v > 0 ? v : null; };
  return {
    ticker, name: typeof q.name === "string" ? q.name : ticker, exchange: typeof q.exchange === "string" ? q.exchange : "",
    currency: typeof q.currency === "string" && /^[A-Z]{3}$/.test(q.currency) ? q.currency : "USD",
    price, change: n(q.change), percentChange: n(q.percent_change), previousClose: positive(q.previous_close),
    open: positive(q.open), high: positive(q.high), low: positive(q.low), volume: n(q.volume),
    week52Low: positive(year.low), week52High: positive(year.high), asOf: new Date(at).toISOString(), marketOpen: q.is_market_open === true,
  };
}
/** A multi-symbol /quote answer is keyed by symbol; a single-symbol answer is the quote itself. */
export function parseQuotes(raw: unknown, tickers: readonly string[]): Record<string, MarketQuote> {
  const body = obj(raw), out: Record<string, MarketQuote> = {};
  for (const ticker of tickers) {
    const one = tickers.length === 1 && "close" in body ? body : body[ticker];
    const quote = parseQuote(one, ticker);
    if (quote) out[ticker] = quote;
  }
  return out;
}
/** Bars newest-first in the answer; returned oldest-first, only well-formed ones. */
export function parseBars(raw: unknown): Bar[] {
  const body = obj(raw);
  if (body.status === "error" || !Array.isArray(body.values)) return [];
  const bars: Bar[] = [];
  for (const item of body.values) {
    const r = obj(item), open = n(r.open), high = n(r.high), low = n(r.low), close = n(r.close);
    if (typeof r.datetime !== "string" || open === null || high === null || low === null || close === null || close <= 0) continue;
    bars.push({ at: r.datetime, open, high, low, close });
  }
  return bars.sort((a, b) => a.at.localeCompare(b.at));
}
export function chartSpec(range: ChartRange, now = Date.now()): { interval: "5min" | "30min" | "1day" | "1week"; size: number } {
  const ytdDays = Math.min(260, Math.max(5, Math.ceil((now - Date.UTC(new Date(now).getUTCFullYear(), 0, 1)) / 86400000)));
  switch (range) {
    case "1d": return { interval: "5min", size: 160 };   // two sessions, so a Monday morning still has data to trim
    case "1w": return { interval: "30min", size: 140 };
    case "1m": return { interval: "1day", size: 23 };
    case "3m": return { interval: "1day", size: 66 };
    case "6m": return { interval: "1day", size: 130 };
    case "ytd": return { interval: "1day", size: ytdDays };
    case "1y": return { interval: "1day", size: 260 };
    case "3y": return { interval: "1week", size: 160 };
    default: return { interval: "1week", size: 270 };
  }
}
const day = (at: string) => at.slice(0, 10);
/** Keeps what the range means: the last session for 1D, the last five sessions for 1W, this calendar year for YTD. */
export function trimBars(bars: Bar[], range: ChartRange): Bar[] {
  if (!bars.length) return bars;
  const last = bars[bars.length - 1], days = [...new Set(bars.map(b => day(b.at)))];
  if (range === "1d") return bars.filter(b => day(b.at) === day(last.at));
  if (range === "1w") { const keep = new Set(days.slice(-5)); return bars.filter(b => keep.has(day(b.at))); }
  if (range === "ytd") return bars.filter(b => b.at.slice(0, 4) === last.at.slice(0, 4));
  return bars;
}
export function rangeChange(bars: Bar[], previousClose: number | null, range: ChartRange) {
  if (!bars.length) return null;
  const base = range === "1d" && previousClose ? previousClose : bars[0].open > 0 && range !== "1d" ? bars[0].open : bars[0].open;
  const last = bars[bars.length - 1].close;
  if (!(base > 0)) return null;
  return { change: last - base, percent: (last / base - 1) * 100 };
}

const easternParts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
/** "2026-11-09 15:55:00" in New York time (daylight saving included) as an ISO instant; "" when it is not a datetime. */
export function easternToIso(text: string): string {
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return "";
  const [y, mo, d, h, mi, se] = [m[1], m[2], m[3], m[4] ?? "0", m[5] ?? "0", m[6] ?? "0"].map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi, se);
  const seen = Object.fromEntries(easternParts.formatToParts(new Date(guess)).map(p => [p.type, Number(p.value)]));
  const offset = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second) - guess;
  return new Date(guess - offset).toISOString();
}
/** FavoriteQuote (the watchlist's own contract) from a quote and the same session's 5-minute closes. */
export function toFavoriteQuote(q: MarketQuote, intraday: Bar[] = []): FavoriteQuote {
  const history = intraday.map(b => ({ at: easternToIso(b.at), price: b.close })).filter(p => Number.isFinite(Date.parse(p.at)));
  return { ticker: q.ticker, price: q.price, change: q.change, percentChange: q.percentChange, currency: q.currency, asOf: q.asOf,
    session: q.marketOpen ? "regular" : "closed", delayed: false, source: "twelve-data", ...(history.length > 1 ? { history } : {}) };
}

export type MarketFacts = { eps: number | null; marketCap: number | null; dividendYield: number | null; nextEarnings: string | null };
export function parseStatistics(raw: unknown, ticker: string): Omit<MarketFacts, "nextEarnings"> | null {
  const root = obj(raw), meta = obj(root.meta), s = obj(root.statistics);
  if (root.status === "error" || (typeof meta.symbol === "string" && meta.symbol.toUpperCase() !== ticker.toUpperCase())) return null;
  const valuations = obj(s.valuations_metrics), income = obj(obj(s.financials).income_statement), dividends = obj(s.dividends_and_splits);
  const cap = n(valuations.market_capitalization), yieldRaw = n(dividends.forward_annual_dividend_yield) ?? n(dividends.trailing_annual_dividend_yield);
  return { eps: n(income.diluted_eps_ttm), marketCap: cap !== null && cap > 0 ? cap : null,
    // The provider states the yield as a fraction (0.0006 = 0.06%).
    dividendYield: yieldRaw !== null && yieldRaw >= 0 && yieldRaw < 1 ? yieldRaw * 100 : null };
}
/** The next earnings date at or after `today` from Twelve Data's /earnings answer. */
export function parseNextEarnings(raw: unknown, today: string): string | null {
  const list = obj(raw).earnings;
  if (!Array.isArray(list)) return null;
  const dates = list.map(item => obj(item).date).filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today).sort();
  return dates[0] ?? null;
}

/** "715.41 USD": one half-width space between the number and the currency. */
export const money = (value: number, currency = "USD") => `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
export const signedMoney = (value: number, currency = "USD") => `${value < 0 ? "−" : "+"}${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
export const signedPercent = (value: number) => `${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(2)}%`;
export const plain = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e11) return `${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return String(Math.round(value));
}
export const dateJa = (iso: string | null, lang: "ja" | "en" = "ja") => {
  const m = iso?.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!m) return "—";
  return lang === "ja" ? `${Number(m[1])}月${Number(m[2])}日` : new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};
/** Where the price sits in its 52-week range, 0–100. */
export function rangePosition(price: number, low: number | null, high: number | null): number | null {
  if (low === null || high === null || !(high > low)) return null;
  return Math.max(0, Math.min(100, (price - low) / (high - low) * 100));
}
export function nextEarningsFromSite(ticker: string, events: { ticker?: string; startsAt?: string; date?: string }[], today: string): string | null {
  const dates = events.filter(e => e.ticker === ticker).map(e => (e.date ?? e.startsAt ?? "").slice(0, 10)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today).sort();
  return dates[0] ?? null;
}
