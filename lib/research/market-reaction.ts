import rosters from "../resolute/thermometer-rosters.json" with { type: "json" };

/** 「翌日の市場の反応」 (owner, Nov 18): how the stock moved in the first U.S. regular session that closed after an earnings release, computed
 * from daily prices only (no AI, no wording of ours beyond fixed labels). Pure functions: no network. The server loader is market-reaction-server.ts.
 * Nothing is returned until that session's close is final, so a reader never sees a half-made section. */
export type DailyBar = { at: string; open: number; high: number; low: number; close: number; volume: number | null };
export type Benchmark = { symbol: "SMH" | "QQQ"; ja: string; en: string };
export type MarketReaction = {
  /** The first regular session that closed after the release (New York date), and the session before it. */
  session: string; previousSession: string;
  /** Close-to-close change of the session, percent. */
  closeChange: number;
  /** Open vs the previous close, and the session's low / high vs the previous close, percent. */
  gap: number | null; rangeLow: number | null; rangeHigh: number | null;
  /** The session's volume ÷ the average of the 20 sessions before it. */
  volumeRatio: number | null;
  benchmark: (Benchmark & { change: number }) | null;
  /** Stock change − benchmark change, percentage points. */
  relative: number | null;
  /** Up to five closes around the release (three sessions before the reaction session, the session, and the one after once it has closed). */
  series: { date: string; close: number }[];
  /** Index in `series` of the reaction session (the release falls between this point and the one before). */
  releaseIndex: number;
};

/** Semiconductor names (the TP半導体40 roster behind the Shock Gauge) are compared with the semiconductor ETF, everything else with the NASDAQ 100 ETF. */
const SEMICONDUCTORS = new Set<string>(rosters.semiconductors.tickers);
const BENCHMARKS: Record<Benchmark["symbol"], Benchmark> = {
  SMH: { symbol: "SMH", ja: "半導体ETF（SMH）", en: "Semiconductor ETF (SMH)" },
  QQQ: { symbol: "QQQ", ja: "NASDAQ100連動ETF（QQQ）", en: "NASDAQ-100 ETF (QQQ)" },
};
export function benchmarkFor(ticker: string): Benchmark { return BENCHMARKS[SEMICONDUCTORS.has(ticker) ? "SMH" : "QQQ"]; }

const nyClock = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit", minute: "2-digit" });
/** The instant of hh:mm New York time on a New York date (YYYY-MM-DD), whatever the daylight-saving offset. */
export function newYorkTime(date: string, hour: number, minute = 0): number {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  for (const offset of [4, 5]) {
    const at = Date.UTC(y, m - 1, d, hour + offset, minute);
    const parts = nyClock.formatToParts(new Date(at));
    if (Number(parts.find(p => p.type === "hour")?.value) === hour && Number(parts.find(p => p.type === "minute")?.value) === minute) return at;
  }
  return NaN;
}
/** A daily bar counts once its session has closed and the provider has had time to settle it (17:00 New York). */
export const FINAL_AFTER = { hour: 17, minute: 0 };
const closeOf = (date: string) => newYorkTime(date, 16);
const finalAt = (date: string) => newYorkTime(date, FINAL_AFTER.hour, FINAL_AFTER.minute);

const pct = (now: number, before: number) => (now / before - 1) * 100;
const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
const day = (bar: DailyBar) => bar.at.slice(0, 10);
const valid = (bar: DailyBar) => /^\d{4}-\d{2}-\d{2}$/.test(day(bar)) && [bar.open, bar.high, bar.low, bar.close].every(v => Number.isFinite(v) && v > 0);

/** The reaction to a release at `releasedAt` (ISO), from the stock's daily bars and the benchmark's (either order), at `now` (ms).
 * null while the reaction session has not closed and settled, when the session before it is missing, or when the release time is unreadable. */
export function marketReaction(stockBars: readonly DailyBar[], benchBars: readonly DailyBar[] | null, benchmark: Benchmark | null, releasedAt: string, now: number): MarketReaction | null {
  const released = Date.parse(releasedAt);
  if (!Number.isFinite(released)) return null;
  const bars = [...new Map(stockBars.filter(valid).map(bar => [day(bar), bar])).values()].sort((a, b) => day(a).localeCompare(day(b)))
    .filter(bar => finalAt(day(bar)) <= now);
  const index = bars.findIndex(bar => closeOf(day(bar)) > released);
  if (index < 1) return null;
  const bar = bars[index], before = bars[index - 1];
  // Only a session right after the release: a gap of more than a week (missing data) would compare unrelated days.
  if (closeOf(day(bar)) - released > 7 * 86400_000) return null;
  const closeChange = pct(bar.close, before.close);
  const window = bars.slice(Math.max(0, index - 20), index).map(b => b.volume);
  const volumeRatio = window.length === 20 && window.every(v => v !== null && v > 0) && bar.volume !== null && bar.volume > 0
    ? bar.volume / (window.reduce((sum: number, v) => sum + (v as number), 0) / 20) : null;
  let bench: MarketReaction["benchmark"] = null;
  if (benchmark && benchBars) {
    const map = new Map(benchBars.filter(valid).map(b => [day(b), b.close]));
    const now0 = map.get(day(bar)), then = map.get(day(before));
    if (now0 !== undefined && then !== undefined) bench = { ...benchmark, change: round(pct(now0, then)) };
  }
  const series = bars.slice(Math.max(0, index - 3), index + 2).map(b => ({ date: day(b), close: b.close }));
  return {
    session: day(bar), previousSession: day(before), closeChange: round(closeChange),
    gap: round(pct(bar.open, before.close)), rangeLow: round(pct(bar.low, before.close)), rangeHigh: round(pct(bar.high, before.close)),
    volumeRatio: volumeRatio === null ? null : round(volumeRatio, 1), benchmark: bench,
    relative: bench ? round(round(closeChange) - bench.change) : null,
    series, releaseIndex: series.findIndex(point => point.date === day(bar)),
  };
}

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const nullableFinite = (x: unknown) => x === null || finite(x);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A reaction as served to the browser, checked field by field (null when anything is off). */
export function parseMarketReaction(raw: unknown): MarketReaction | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return null;
  if (typeof r.session !== "string" || !DATE.test(r.session) || typeof r.previousSession !== "string" || !DATE.test(r.previousSession)) return null;
  if (!finite(r.closeChange) || Math.abs(r.closeChange) > 90 || ![r.gap, r.rangeLow, r.rangeHigh, r.volumeRatio, r.relative].every(nullableFinite)) return null;
  const series = r.series;
  if (!Array.isArray(series) || series.length < 2 || series.length > 5
    || !series.every(p => p && typeof p.date === "string" && DATE.test(p.date) && finite(p.close) && p.close > 0)) return null;
  if (!Number.isInteger(r.releaseIndex) || (r.releaseIndex as number) < 1 || (r.releaseIndex as number) >= series.length) return null;
  const b = r.benchmark as Record<string, unknown> | null;
  const benchmark = b === null ? null : b && (b.symbol === "SMH" || b.symbol === "QQQ") && finite(b.change)
    ? { ...BENCHMARKS[b.symbol as Benchmark["symbol"]], change: b.change } : undefined;
  if (benchmark === undefined) return null;
  return { session: r.session, previousSession: r.previousSession, closeChange: r.closeChange, gap: r.gap as number | null,
    rangeLow: r.rangeLow as number | null, rangeHigh: r.rangeHigh as number | null, volumeRatio: r.volumeRatio as number | null,
    benchmark, relative: benchmark ? r.relative as number | null : null,
    series: series.map(p => ({ date: p.date, close: p.close })), releaseIndex: r.releaseIndex as number };
}
