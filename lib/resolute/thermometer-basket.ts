import type { DailyClose } from './thermometer.ts';

/** Equal-weight baskets and realized volatility behind RESOLUTE's thermometer (TP大型株100 / TP半導体40 / TP恐怖指数).
 * Pure functions: no I/O. Rosters live in thermometer-rosters.json.
 */
export type BasketSeries = Record<string, readonly DailyClose[]>;

/** A date is part of the basket calendar when at least this many tickers have a price that day. */
export const MIN_TICKERS_PER_DAY = 10;

/** Equal-weight average of the stocks' daily returns, chained into a level starting at 100.
 * A stock only counts on days where it has a price that day and on the previous basket day,
 * so new listings join when they start trading and missing tickers never stop the calculation.
 */
export function equalWeightLevels(series: BasketSeries, minTickers = MIN_TICKERS_PER_DAY): DailyClose[] {
  const maps = Object.values(series).map(bars => new Map(bars.filter(bar => Number.isFinite(bar.close) && bar.close > 0).map(bar => [bar.date, bar.close])));
  const counts = new Map<string, number>();
  for (const map of maps) for (const date of map.keys()) counts.set(date, (counts.get(date) ?? 0) + 1);
  const dates = [...counts].filter(([, count]) => count >= minTickers).map(([date]) => date).sort();
  const levels: DailyClose[] = [];
  let level = 100;
  for (let i = 0; i < dates.length; i++) {
    if (i > 0) {
      let sum = 0, n = 0;
      for (const map of maps) {
        const now = map.get(dates[i]), before = map.get(dates[i - 1]);
        if (now !== undefined && before !== undefined) { sum += now / before - 1; n++; }
      }
      if (n >= minTickers) level *= 1 + sum / n;
      else continue; // no usable day-over-day pair: leave a gap rather than invent a move
    }
    levels.push({ date: dates[i], close: level });
  }
  return levels;
}

/** 20-trading-day realized volatility of a level series, annualised (sample standard deviation of daily log returns × √252, in percent).
 * Needs a strictly positive series; the first value is dated on the 20th return.
 */
export function realizedVolatility(levels: readonly DailyClose[], window = 20): DailyClose[] {
  const sorted = levels.slice().sort((a, b) => a.date.localeCompare(b.date));
  const returns: number[] = [];
  const out: DailyClose[] = [];
  for (let i = 1; i < sorted.length; i++) {
    returns.push(Math.log(sorted[i].close / sorted[i - 1].close));
    if (returns.length < window) continue;
    const slice = returns.slice(-window);
    const mean = slice.reduce((sum, value) => sum + value, 0) / window;
    const variance = slice.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (window - 1);
    const close = 100 * Math.sqrt(variance * 252);
    if (Number.isFinite(close) && close > 0) out.push({ date: sorted[i].date, close });
  }
  return out;
}

/** One basket's close-to-close move on a confirmed session (used by the Shock Gauge stars).
 * Only when the session itself has a level and the previous basket day is at most 7 calendar days earlier. Never guessed.
 */
export type DailyMove = { date: string; previousDate: string; changePercent: number };
export function dailyMove(levels: readonly DailyClose[], session: string): DailyMove | null {
  const sorted = levels.filter(bar => bar.date <= session).slice().sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted.at(-1), previous = sorted.at(-2);
  if (!last || !previous || last.date !== session || !(last.close > 0) || !(previous.close > 0)) return null;
  const days = (Date.parse(last.date) - Date.parse(previous.date)) / 86400000;
  if (!(days > 0 && days <= 7)) return null;
  const changePercent = 100 * (last.close / previous.close - 1);
  return Number.isFinite(changePercent) && Math.abs(changePercent) < 100 ? { date: last.date, previousDate: previous.date, changePercent } : null;
}

/** Shock Gauge (Nov 25, owner-approved method): how unusual and how broad one basket's close-to-close move was.
 * typicalPercent: the basket's typical daily move: the MEDIAN of the absolute daily % moves over the SHOCK_TYPICAL_DAYS sessions
 * before it (a median, so one or two crash days do not make every later move look small).
 * up / down / total: constituents that closed higher / lower than on the basket's previous day (total = with both prices).
 * Never guessed: null without the session, its previous day, a full typical-move window, or enough constituents.
 */
export const SHOCK_TYPICAL_DAYS = 60;
export type ShockReading = DailyMove & { typicalPercent: number; up: number; down: number; total: number };
export function sessionShock(levels: readonly DailyClose[], series: BasketSeries, session: string, window = SHOCK_TYPICAL_DAYS): ShockReading | null {
  const move = dailyMove(levels, session);
  if (!move) return null;
  const sorted = levels.filter(bar => bar.date < session && bar.close > 0).slice().sort((a, b) => a.date.localeCompare(b.date));
  const returns: number[] = [];
  for (let i = 1; i < sorted.length; i++) returns.push(100 * (sorted[i].close / sorted[i - 1].close - 1));
  if (returns.length < window) return null;
  const slice = returns.slice(-window).map(Math.abs).sort((a, b) => a - b);
  const typicalPercent = window % 2 ? slice[(window - 1) / 2] : (slice[window / 2 - 1] + slice[window / 2]) / 2;
  if (!(typicalPercent > 0) || !Number.isFinite(typicalPercent)) return null;
  let up = 0, down = 0, total = 0;
  for (const bars of Object.values(series)) {
    const now = bars.find(bar => bar.date === session)?.close, before = bars.find(bar => bar.date === move.previousDate)?.close;
    if (!(now! > 0) || !(before! > 0)) continue;
    total++; if (now! > before!) up++; else if (now! < before!) down++;
  }
  if (total < MIN_TICKERS_PER_DAY) return null;
  return { ...move, typicalPercent, up, down, total };
}
/** Shock Gauge intraday extreme (owner, Nov 26: NASDAQ-100 fell more than 4.5% intraday and closed −0.6%; the close alone called
 * it a quiet day). For each basket day: the equal-weight average of the constituents' intraday low and high against their own
 * previous close; the day's extreme is the deeper of the two (signed). Constituents do not all bottom at the same minute, so this
 * reads somewhat deeper than the basket's true intraday low; the usual move is measured the same way (the median over the
 * `window` days before), so the multiple stays comparable. same: constituents that went beyond their previous close by more
 * than that usual extreme in the day's direction. Never guessed: null without the session, its previous day, a full window of
 * days with intraday ranges, or enough constituents. */
export type IntradayReading = { date: string; previousDate: string; changePercent: number; typicalPercent: number; same: number; total: number };
export function sessionIntraday(levels: readonly DailyClose[], series: BasketSeries, session: string, window = SHOCK_TYPICAL_DAYS): IntradayReading | null {
  const dates = levels.map(bar => bar.date).filter(date => date <= session).sort();
  const at = dates.length - 1;
  if (at < window + 1 || dates[at] !== session) return null;
  const maps = Object.values(series).map(bars => new Map(bars.map(bar => [bar.date, bar])));
  const day = (i: number) => {
    const downs: number[] = [], ups: number[] = [];
    for (const map of maps) {
      const now = map.get(dates[i]), before = map.get(dates[i - 1])?.close;
      if (!now || !(before! > 0) || !(now.low! > 0) || !(now.high! > 0)) continue;
      downs.push(100 * (now.low! / before! - 1)); ups.push(100 * (now.high! / before! - 1));
    }
    if (downs.length < MIN_TICKERS_PER_DAY) return null;
    const down = downs.reduce((a, b) => a + b, 0) / downs.length, up = ups.reduce((a, b) => a + b, 0) / ups.length;
    return { extreme: Math.abs(down) >= Math.abs(up) ? down : up, downs, ups };
  };
  const today = day(at);
  if (!today) return null;
  const past: number[] = [];
  for (let i = at - window; i < at; i++) { const d = day(i); if (!d) return null; past.push(Math.abs(d.extreme)); }
  past.sort((a, b) => a - b);
  const typicalPercent = window % 2 ? past[(window - 1) / 2] : (past[window / 2 - 1] + past[window / 2]) / 2;
  if (!(typicalPercent > 0) || !Number.isFinite(typicalPercent)) return null;
  const same = today.extreme < 0 ? today.downs.filter(x => x <= -typicalPercent).length : today.ups.filter(x => x >= typicalPercent).length;
  return { date: session, previousDate: dates[at - 1], changePercent: Math.round(today.extreme * 1000) / 1000, typicalPercent: Math.round(typicalPercent * 10000) / 10000, same, total: today.downs.length };
}
/** TP恐怖指数 (realized volatility of the large-cap basket) on the session and on the day before. */
export type FearReading = { date: string; level: number; previousLevel: number };
export function sessionFear(largeLevels: readonly DailyClose[], session: string): FearReading | null {
  const vol = realizedVolatility(largeLevels);
  const i = vol.findIndex(bar => bar.date === session);
  if (i < 1 || !(vol[i].close > 0) || !(vol[i - 1].close > 0)) return null;
  return { date: session, level: vol[i].close, previousLevel: vol[i - 1].close };
}
/** Shock Gauge single-company news (owner, Nov 25): one stock's own close-to-close move on a session and its typical daily move
 * (the median of its absolute daily % moves over the `window` sessions before), the same concept as a basket's. Never guessed:
 * null without the session's close, a previous close at most 7 days earlier, or a full typical-move window. */
export type StockShock = { date: string; previousDate: string; changePercent: number; typicalPercent: number; intradayPercent?: number };
export function stockShock(bars: readonly DailyClose[], session: string, window = SHOCK_TYPICAL_DAYS): StockShock | null {
  const sorted = bars.filter(bar => bar.date <= session && Number.isFinite(bar.close) && bar.close > 0).slice().sort((a, b) => a.date.localeCompare(b.date));
  const move = dailyMove(sorted, session);
  if (!move) return null;
  const returns: number[] = [];
  for (let i = 1; i < sorted.length - 1; i++) returns.push(100 * (sorted[i].close / sorted[i - 1].close - 1));
  if (returns.length < window) return null;
  const slice = returns.slice(-window).map(Math.abs).sort((a, b) => a - b);
  const typicalPercent = window % 2 ? slice[(window - 1) / 2] : (slice[window / 2 - 1] + slice[window / 2]) / 2;
  if (!(typicalPercent > 0) || !Number.isFinite(typicalPercent)) return null;
  // The stock's own intraday extreme against its previous close (the deeper of its low and high), when the bar has a range.
  const bar = sorted.at(-1)!, before = sorted.at(-2)!.close;
  const low = bar.low! > 0 ? 100 * (bar.low! / before - 1) : null, high = bar.high! > 0 ? 100 * (bar.high! / before - 1) : null;
  const intradayPercent = low !== null && high !== null ? Math.round((Math.abs(low) >= Math.abs(high) ? low : high) * 1000) / 1000 : undefined;
  return { date: session, previousDate: move.previousDate, changePercent: Math.round(move.changePercent * 1000) / 1000, typicalPercent: Math.round(typicalPercent * 10000) / 10000, ...(intradayPercent !== undefined ? { intradayPercent } : {}) };
}
