import rosters from './thermometer-rosters.json' with { type: 'json' };
import { dailyMove, equalWeightLevels, realizedVolatility, sessionFear, sessionShock, type ShockReading, type FearReading, type BasketSeries } from './thermometer-basket.ts';
import { calculateTemperature, calculateVixContext, validSessionDate, type DailyClose } from './thermometer.ts';
import { bigDrops, similarDays } from './similar-days.ts';

export type ThermometerRosters = { nasdaq100: string[]; semiconductors: string[] };
export const THERMOMETER_ROSTERS: ThermometerRosters = { nasdaq100: rosters.nasdaq100.tickers, semiconductors: rosters.semiconductors.tickers };
export type ThermometerProviderConfig = { enabled: boolean; apiKey?: string; rosters?: ThermometerRosters };
type ProviderFailure = { status: 'unavailable'; reason: 'not-configured' | 'provider-error' | 'invalid-data' };
const CHUNK = 10;
export const SHOCK_SESSIONS = 10;
export type ShockSession = { nas100: ShockReading | null; sox: ShockReading | null; fear: FearReading | null };
/** Twelve Data treats a date-only end_date as exclusive, so ask for the day after the confirmed session. Later bars are dropped by the calculator. */
function dayAfter(date: string): string { const next = new Date(`${date}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1); return next.toISOString().slice(0, 10); }
/** Parses a multi-symbol (or single-symbol) Twelve Data time_series reply into daily closes per ticker.
 * Tickers that the provider did not return, or returned with bad numbers, are reported as missing, never guessed.
 */
export function parseStockHistories(payload: unknown, tickers: readonly string[]): { series: Record<string, DailyClose[]>; missing: string[] } {
  const series: Record<string, DailyClose[]> = {}, missing: string[] = [];
  const body = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  for (const ticker of tickers) {
    const entry = (tickers.length === 1 && Array.isArray(body.values) ? body : body[ticker]) as Record<string, unknown> | undefined;
    const values = entry && entry.status !== 'error' && Array.isArray(entry.values) ? entry.values : null;
    const bars: DailyClose[] = [];
    for (const item of values ?? []) {
      const row = (item ?? {}) as Record<string, unknown>;
      const close = Number(row.close);
      if (validSessionDate(row.datetime) && Number.isFinite(close) && close > 0) bars.push({ date: row.datetime, close });
    }
    if (bars.length) series[ticker] = bars; else missing.push(ticker);
  }
  return { series, missing };
}
/** Server/job entry point. Injected fetch allows all acceptance tests without API calls.
 * No environment lookup, retries, raw-history response, or logging of credentialed URLs.
 * Caller owns session-finality, scheduling and durable caching; this is not a browser endpoint.
 * `missing` lists tickers that could not be loaded; the run continues without them.
 */
export async function collectThermometer(config: ThermometerProviderConfig, confirmedSession: string, fetcher: typeof fetch) {
  const notConfigured: ProviderFailure = { status: 'unavailable', reason: 'not-configured' };
  if (!config.enabled || !config.apiKey) return { asOf: confirmedSession, nas100: notConfigured, sox: notConfigured, vix: notConfigured, missing: [] as string[] };
  if (!validSessionDate(confirmedSession)) throw new Error('invalid-confirmed-session');
  const lists = config.rosters ?? THERMOMETER_ROSTERS;
  const missing: string[] = [];
  async function loadBasket(tickers: readonly string[]): Promise<{ levels: DailyClose[]; series: BasketSeries } | ProviderFailure> {
    const series: Record<string, DailyClose[]> = {};
    let reached = false;
    for (let i = 0; i < tickers.length; i += CHUNK) {
      const chunk = tickers.slice(i, i + CHUNK);
      const url = new URL('https://api.twelvedata.com/time_series');
      for (const [key, value] of Object.entries({ symbol: chunk.join(','), interval: '1day', outputsize: '2900', adjust: 'splits', end_date: dayAfter(confirmedSession), apikey: config.apiKey! })) url.searchParams.set(key, value);
      try {
        const response = await fetcher(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000) });
        if (!response.ok) { missing.push(...chunk); continue; }
        const parsed = parseStockHistories(await response.json(), chunk);
        reached = true;
        Object.assign(series, parsed.series); missing.push(...parsed.missing);
      } catch { missing.push(...chunk); }
    }
    if (!reached) return { status: 'unavailable', reason: 'provider-error' };
    const levels = equalWeightLevels(series);
    return levels.length ? { levels, series } : { status: 'unavailable', reason: 'invalid-data' };
  }
  // Independent failures: the semiconductor basket never contaminates the large-cap one. Fear is derived from the large-cap basket.
  const large = await loadBasket(lists.nasdaq100), chips = await loadBasket(lists.semiconductors);
  const nas100 = 'levels' in large ? calculateTemperature('nas100', large.levels, confirmedSession) : large;
  const sox = 'levels' in chips ? calculateTemperature('sox', chips.levels, confirmedSession) : chips;
  const vix = 'levels' in large ? calculateVixContext(realizedVolatility(large.levels), confirmedSession) : large;
  // Day-over-day basket moves for the Shock Gauge stars; independent of the 10-year history the temperature needs.
  const moves = { nas100: 'levels' in large ? dailyMove(large.levels, confirmedSession) : null, sox: 'levels' in chips ? dailyMove(chips.levels, confirmedSession) : null };
  // Shock Gauge (Nov 25): how unusual and how broad each basket's move was, and the fear index change, for the last
  // SHOCK_SESSIONS sessions (from the same data: no extra provider calls). Kept in every snapshot so a story's close is
  // still measurable on the next morning even if one snapshot is missing.
  const shock: Record<string, ShockSession> = {};
  if ('levels' in large) {
    const dates = large.levels.map(bar => bar.date).filter(date => date <= confirmedSession).slice(-SHOCK_SESSIONS);
    for (const date of dates) shock[date] = { nas100: sessionShock(large.levels, large.series, date), sox: 'levels' in chips ? sessionShock(chips.levels, chips.series, date) : null, fear: sessionFear(large.levels, date) };
  }
  // 今夜のひと息「今日と似た日」(Nov 25): the days in the past ten years that moved like tonight, and the past big falls, from the
  // same basket levels (no extra provider calls). Each basket on its own; a basket without ten years of levels gets none.
  const history = { nas100: 'levels' in large ? similarDays(large.levels, confirmedSession) : null, sox: 'levels' in chips ? similarDays(chips.levels, confirmedSession) : null };
  const drops = { nas100: 'levels' in large ? bigDrops(large.levels, confirmedSession) : null, sox: 'levels' in chips ? bigDrops(chips.levels, confirmedSession) : null };
  return { asOf: confirmedSession, nas100, sox, vix, moves, shock, history, drops, missing: [...new Set(missing)].sort() };
}
