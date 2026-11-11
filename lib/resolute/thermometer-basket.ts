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
