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
/** TP恐怖指数 (realized volatility of the large-cap basket) on the session and on the day before. */
export type FearReading = { date: string; level: number; previousLevel: number };
export function sessionFear(largeLevels: readonly DailyClose[], session: string): FearReading | null {
  const vol = realizedVolatility(largeLevels);
  const i = vol.findIndex(bar => bar.date === session);
  if (i < 1 || !(vol[i].close > 0) || !(vol[i - 1].close > 0)) return null;
  return { date: session, level: vol[i].close, previousLevel: vol[i - 1].close };
}
