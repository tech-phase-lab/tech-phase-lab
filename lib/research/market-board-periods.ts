import { easternToIso, splitBars, WARMUP, type Bar } from "./market-quote.ts";

/** The market board's period buttons: the candle size and the span each one shows (owner, Nov 13). */
export type BoardPeriod = "5m" | "15m" | "1h" | "3h" | "1d" | "1w" | "1m" | "6m" | "1y" | "5y";
export const DEFAULT_PERIOD: BoardPeriod = "15m";
/** Always visible, in this order; the rest sit in the "More" pull-down. */
export const PRIMARY_PERIODS: readonly BoardPeriod[] = ["5m", "15m", "1d", "1m", "6m", "1y"];
export const OTHER_PERIODS: readonly BoardPeriod[] = ["1h", "3h", "1w", "5y"];
export const BOARD_PERIODS: readonly BoardPeriod[] = [...PRIMARY_PERIODS, ...OTHER_PERIODS];
export const isBoardPeriod = (value: unknown): value is BoardPeriod => typeof value === "string" && (BOARD_PERIODS as readonly string[]).includes(value);

export const PERIOD_LABEL: Record<BoardPeriod, { ja: string; en: string; jaNote: string; enNote: string }> = {
  "5m": { ja: "5分", en: "5m", jaNote: "5分足 ・ 直近1日", enNote: "5-min candles · last day" },
  "15m": { ja: "15分", en: "15m", jaNote: "15分足 ・ 直近5日", enNote: "15-min candles · last 5 days" },
  "1h": { ja: "1時間", en: "1h", jaNote: "1時間足 ・ 直近1ヶ月", enNote: "1-hour candles · last month" },
  "3h": { ja: "3時間", en: "3h", jaNote: "3時間足 ・ 直近3ヶ月", enNote: "3-hour candles · last 3 months" },
  "1d": { ja: "1日", en: "1D", jaNote: "日足 ・ 直近3ヶ月", enNote: "Daily candles · last 3 months" },
  "1w": { ja: "1週間", en: "1W", jaNote: "週足 ・ 直近2年", enNote: "Weekly candles · last 2 years" },
  "1m": { ja: "1ヶ月", en: "1M", jaNote: "日足 ・ 直近1ヶ月", enNote: "Daily candles · last month" },
  "6m": { ja: "6ヶ月", en: "6M", jaNote: "日足 ・ 直近6ヶ月", enNote: "Daily candles · last 6 months" },
  "1y": { ja: "1年", en: "1Y", jaNote: "日足 ・ 直近1年", enNote: "Daily candles · last year" },
  "5y": { ja: "5年", en: "5Y", jaNote: "週足 ・ 直近5年", enNote: "Weekly candles · last 5 years" },
};

/** Candles of 5 / 15 / 60 / 180 minutes carry pre-market and after-hours bars (drawn in bands) and refresh every 15 seconds; the longer ones do not. */
export const isIntradayPeriod = (period: BoardPeriod) => period === "5m" || period === "15m" || period === "1h" || period === "3h";
export const periodInterval = (period: BoardPeriod): "intraday" | "daily" | "weekly" => isIntradayPeriod(period) ? "intraday" : period === "1w" || period === "5y" ? "weekly" : "daily";

type Series = { interval: "5min" | "15min" | "30min" | "1day" | "1week"; size: number };
/** What is asked of the provider. 1h and 3h share one series of 30-minute bars (the provider has no pre-market / after-hours hourly bars), the daily periods share one, the weekly ones share one. */
export function periodSeries(period: BoardPeriod): Series {
  switch (period) {
    case "5m": return { interval: "5min", size: 400 + WARMUP };
    case "15m": return { interval: "15min", size: 330 + WARMUP };
    case "1h": case "3h": return { interval: "30min", size: 2016 + 2 * WARMUP };
    case "1w": case "5y": return { interval: "1week", size: 260 + WARMUP };
    default: return { interval: "1day", size: 252 + WARMUP };
  }
}

const minutesOf = (at: string) => Number(at.slice(11, 13)) * 60 + Number(at.slice(14, 16));
/** Pre-market (before 9:30), regular (9:30–16:00) or after-hours (16:00 on), by the bar's New York time. */
export const segmentOf = (at: string): "pre" | "regular" | "post" => at.length < 16 ? "regular" : minutesOf(at) < 570 ? "pre" : minutesOf(at) >= 960 ? "post" : "regular";
const stamp = (day: string, minutes: number) => `${day} ${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00`;

/** One bar from several: open of the first, highest high, lowest low, close of the last, summed volume (unknown when none of them knew it). */
export function mergeBars(group: Bar[], at: string = group[0].at): Bar {
  const volumes = group.map(b => b.volume).filter((v): v is number => v !== null);
  return { at, open: group[0].open, high: Math.max(...group.map(b => b.high)), low: Math.min(...group.map(b => b.low)), close: group[group.length - 1].close, volume: volumes.length ? volumes.reduce((a, b) => a + b, 0) : null };
}
/** Bars cut into runs by `keyOf` (consecutive bars with the same key), each run merged in chunks of `size`. */
function chunked(bars: Bar[], size: number, keyOf: (b: Bar) => string, atOf: (chunk: Bar[]) => string): Bar[] {
  const out: Bar[] = [];
  let run: Bar[] = [], key = "";
  const flush = () => { for (let i = 0; i < run.length; i += size) { const chunk = run.slice(i, i + size); out.push(mergeBars(chunk, atOf(chunk))); } run = []; };
  for (const bar of bars) { const k = keyOf(bar); if (k !== key) { flush(); key = k; } run.push(bar); }
  flush();
  return out;
}
/** Hourly bars from 30-minute ones: the regular session in hours from 9:30 (9:30, 10:30 … 15:30), pre-market and after-hours in clock hours. */
export function hourlyBars(bars: Bar[]): Bar[] {
  const bucket = (b: Bar) => { const m = minutesOf(b.at); return segmentOf(b.at) === "regular" ? 570 + Math.floor((m - 570) / 60) * 60 : Math.floor(m / 60) * 60; };
  return chunked(bars, Infinity, b => `${b.at.slice(0, 10)}|${segmentOf(b.at)}|${bucket(b)}`, chunk => stamp(chunk[0].at.slice(0, 10), bucket(chunk[0])));
}
/** Three consecutive bars made one, within the same day and the same session part (pre-market, regular, after-hours); the last of a part may be shorter. */
export function groupBars(bars: Bar[], size = 3): Bar[] {
  return chunked(bars, size, b => `${b.at.slice(0, 10)}|${segmentOf(b.at)}`, chunk => chunk[0].at);
}

const lastDays = (bars: Bar[], days: number) => { const keep = new Set([...new Set(bars.map(b => b.at.slice(0, 10)))].slice(-days)); return bars.filter(b => keep.has(b.at.slice(0, 10))); };
const lastN = (bars: Bar[], n: number) => bars.slice(-n);
const withBefore = (all: Bar[], bars: Bar[]) => ({ bars, before: all.slice(0, all.length - bars.length).slice(-WARMUP) });

/** The drawn bars of a period (and the bars before them, for the moving averages) from the series `periodSeries` asked for. */
export function shapePeriod(period: BoardPeriod, all: Bar[], now = Date.now()): { bars: Bar[]; before: Bar[] } {
  switch (period) {
    case "5m": return splitBars(all, "1d", now);
    case "15m": return splitBars(all, "1w", now);
    case "1h": { const hourly = hourlyBars(all); return withBefore(hourly, lastDays(hourly, 22)); }
    case "3h": { const three = groupBars(hourlyBars(all), 3); return withBefore(three, lastDays(three, 63)); }
    case "1d": return withBefore(all, lastN(all, 66));
    case "1m": return withBefore(all, lastN(all, 23));
    case "6m": return withBefore(all, lastN(all, 130));
    case "1y": return withBefore(all, lastN(all, 252));
    case "1w": return withBefore(all, lastN(all, 104));
    case "5y": return withBefore(all, lastN(all, 260));
  }
}

/** The market board's chart, owner Nov 14: a high or low 3% or more away from its own bar's open / close is a bad print (SPY 15-minute lows of 691–722 against
 * closes near 750 came in the provider's data), so it is drawn cut back to the body; the vertical scale follows the cut bars. */
export const WICK_LIMIT = 0.03;
export function clampWick(bar: Bar, limit = WICK_LIMIT): Bar {
  const top = Math.max(bar.open, bar.close), bottom = Math.min(bar.open, bar.close);
  const high = bar.high >= top * (1 + limit) ? top : bar.high, low = bar.low <= bottom * (1 - limit) ? bottom : bar.low;
  return high === bar.high && low === bar.low ? bar : { ...bar, high, low };
}
export const clampWicks = (bars: Bar[], limit = WICK_LIMIT): Bar[] => bars.map(bar => clampWick(bar, limit));

/** The board's 15-minute chart: the latest trading day only (pre-market from 4:00, the session from 9:30, after-hours 16:00–20:00, New York time), which on a
 * weekend or a holiday is the last day that traded. While the new day has only pre-market bars, the previous day is kept in front of them (no near-empty chart).
 * The dropped bars move to `before`, so the moving averages run on. */
export function latestTradingDay(bars: Bar[], before: Bar[] = []): { bars: Bar[]; before: Bar[] } {
  if (!bars.length) return { bars, before };
  const days = [...new Set(bars.map(b => b.at.slice(0, 10)))];
  let keep = days.length - 1;
  const today = bars.filter(b => b.at.slice(0, 10) === days[keep]);
  if (keep > 0 && (today.length < 2 || today.every(b => segmentOf(b.at) === "pre"))) keep--;
  const cut = bars.findIndex(b => b.at.slice(0, 10) >= days[keep]);
  return { bars: bars.slice(cut), before: [...before, ...bars.slice(0, cut)].slice(-WARMUP) };
}

const SEGMENT_START = { pre: 240, regular: 570, post: 960 } as const;
const jstClock = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** Where each part of a day begins (pre-market, session, after-hours) and its nominal start in Japan time: 18:00 / 23:30 / 06:00 in winter, 17:00 / 22:30 / 05:00
 * in summer (worked out from New York time). `previous` is the bar just before the first one, so a view that starts mid-part gets no tick there. */
export function sessionTicks(bars: Bar[], previous?: Bar): { index: number; label: string }[] {
  const out: { index: number; label: string }[] = [];
  bars.forEach((bar, k) => {
    if (bar.at.length < 16) return;
    const prev = k ? bars[k - 1] : previous, segment = segmentOf(bar.at);
    if (prev && prev.at.slice(0, 10) === bar.at.slice(0, 10) && segmentOf(prev.at) === segment) return;
    const iso = easternToIso(stamp(bar.at.slice(0, 10), SEGMENT_START[segment]));
    if (iso) out.push({ index: k, label: jstClock.format(new Date(iso)) });
  });
  return out;
}

/** The band of the extended hours under way: only while it is pre-market or after-hours now (`phase`), over the trailing bars of that part on the right
 * (`from` = their first index; `from` = bars.length when none has come yet, so the chart keeps an empty stretch for it). Otherwise no band and no word. */
export function liveBand(bars: Bar[], phase: string, ja: boolean): { from: number; label: string } | null {
  if (phase !== "pre" && phase !== "post") return null;
  const want = phase === "pre" ? "pre" : "post", lastDay = bars.length ? bars[bars.length - 1].at.slice(0, 10) : "";
  let from = bars.length;
  while (from > 0 && bars[from - 1].at.length >= 16 && bars[from - 1].at.slice(0, 10) === lastDay && segmentOf(bars[from - 1].at) === want) from--;
  return { from, label: phase === "pre" ? (ja ? "プレ" : "Pre") : (ja ? "アフター" : "After") };
}
