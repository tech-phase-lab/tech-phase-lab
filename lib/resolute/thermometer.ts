/** RESOLUTE market gauge v1. Pure daily-close calculations, independent of provider/UI.
 * The caller supplies the last CONFIRMED US session (never today's unfinished bar).
 * NAS100 and SOX are calculated independently. VIX is not part of temperature.
 */
export const THERMOMETER_VERSION = 'daily-close-v1';
export type ThermometerIndex = 'nas100' | 'sox';
export type DailyClose = { date: string; close: number };
export type GaugeUnavailable = { status: 'unavailable'; reason: 'invalid-data' | 'insufficient-history' | 'stale-data' };
export type Temperature = {
  status: 'ready'; version: typeof THERMOMETER_VERSION; index: ThermometerIndex;
  asOf: string; referenceFrom: string; observations: number;
  score: number; band: 0 | 1 | 2 | 3 | 4;
  drawdownPercent: number; deviationPercent: number;
  drawdownPercentile: number; deviationPercentile: number;
};
export function validSessionDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
function tenYearsBefore(date: string): string {
  const year = Number(date.slice(0, 4)) - 10;
  // Clamp leap day to February 28 instead of rolling into March.
  const candidate = `${year}${date.slice(4)}`;
  return validSessionDate(candidate) ? candidate : `${year}-02-28`;
}
/** Midrank ties: a flat series is neutral, not artificially hot. */
export function percentile(value: number, reference: readonly number[]): number {
  if (!Number.isFinite(value) || !reference.length || reference.some(x => !Number.isFinite(x))) throw new Error('invalid-percentile');
  let below = 0, tied = 0;
  for (const x of reference) { if (x < value) below++; else if (x === value) tied++; }
  return 100 * (below + tied / 2) / reference.length;
}
export function temperatureBand(score: number): Temperature['band'] {
  if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error('invalid-score');
  return Math.min(4, Math.floor(score / 20)) as Temperature['band'];
}
function unavailable(reason: GaugeUnavailable['reason']): GaugeUnavailable { return { status: 'unavailable', reason }; }
/** Reject duplicates, malformed bars and gaps rather than silently changing the baseline.
 * Future/unconfirmed bars are excluded before calculating either current or reference values.
 */
function history(input: readonly DailyClose[], asOf: string): DailyClose[] | null {
  if (!validSessionDate(asOf) || !Array.isArray(input) || input.some(bar => !bar || !validSessionDate(bar.date) || !Number.isFinite(bar.close) || bar.close <= 0)) return null;
  const bars = input.filter(bar => bar.date <= asOf).slice().sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < bars.length; i++) {
    const days = (Date.parse(bars[i].date) - Date.parse(bars[i - 1].date)) / 86400000;
    if (days <= 0 || days > 7) return null;
  }
  return bars;
}
export function calculateTemperature(index: ThermometerIndex, input: readonly DailyClose[], asOf: string): Temperature | GaugeUnavailable {
  const bars = history(input, asOf);
  if (!bars) return unavailable('invalid-data');
  if (!bars.length) return unavailable('insufficient-history');
  if (bars.at(-1)!.date !== asOf) return unavailable('stale-data');
  const referenceFrom = tenYearsBefore(asOf);
  const first = bars.findIndex(bar => bar.date >= referenceFrom);
  // Full ten calendar years plus the rolling-high warm-up; no short-history fallback.
  if (first < 251 || !bars[first - 1] || bars[first - 1].date >= referenceFrom) return unavailable('insufficient-history');
  const metrics: { drawdown: number; deviation: number }[] = [];
  for (let i = first; i < bars.length; i++) {
    const mean = bars.slice(i - 199, i + 1).reduce((sum, bar) => sum + bar.close, 0) / 200;
    const high = Math.max(...bars.slice(i - 251, i + 1).map(bar => bar.close));
    metrics.push({ drawdown: 100 * (bars[i].close / high - 1), deviation: 100 * (bars[i].close / mean - 1) });
  }
  const current = metrics.pop()!;
  if (metrics.length < 2400) return unavailable('insufficient-history');
  const drawdowns = metrics.map(x => x.drawdown), deviations = metrics.map(x => x.deviation);
  // Both rise toward hot: drawdown is signed (e.g. -30 is colder than -5).
  const drawdownPercentile = percentile(current.drawdown, drawdowns);
  const deviationPercentile = percentile(current.deviation, deviations);
  const composite = (drawdownPercentile + deviationPercentile) / 2;
  // The mean of two percentiles is NOT itself a percentile. Rank the combined
  // measure again so the five bands describe position in the reference period.
  const referenceScores = metrics.map(x => (percentile(x.drawdown, drawdowns) + percentile(x.deviation, deviations)) / 2);
  const score = percentile(composite, referenceScores);
  return { status: 'ready', version: THERMOMETER_VERSION, index, asOf, referenceFrom,
    observations: metrics.length, score, band: temperatureBand(score),
    drawdownPercent: current.drawdown, deviationPercent: current.deviation,
    drawdownPercentile, deviationPercentile };
}
export function calculateVixContext(input: readonly DailyClose[], asOf: string): GaugeUnavailable | {
  status: 'ready'; asOf: string; level: number; percentile: number; observations: number;
} {
  const bars = history(input, asOf);
  if (!bars) return unavailable('invalid-data');
  if (!bars.length) return unavailable('insufficient-history');
  if (bars.at(-1)!.date !== asOf) return unavailable('stale-data');
  const start = tenYearsBefore(asOf);
  const past = bars.filter(bar => bar.date >= start && bar.date < asOf);
  if (!bars.some(bar => bar.date < start) || past.length < 2400) return unavailable('insufficient-history');
  const level = bars.at(-1)!.close;
  return { status: 'ready', asOf, level, percentile: percentile(level, past.map(bar => bar.close)), observations: past.length };
}
