import rosters from './thermometer-rosters.json' with { type: 'json' };
import { equalWeightLevels, realizedVolatility } from './thermometer-basket.ts';
import { calculateTemperature, calculateVixContext, validSessionDate, type DailyClose } from './thermometer.ts';

export type ThermometerRosters = { nasdaq100: string[]; semiconductors: string[] };
export const THERMOMETER_ROSTERS: ThermometerRosters = { nasdaq100: rosters.nasdaq100.tickers, semiconductors: rosters.semiconductors.tickers };
export type ThermometerProviderConfig = { enabled: boolean; apiKey?: string; rosters?: ThermometerRosters };
type ProviderFailure = { status: 'unavailable'; reason: 'not-configured' | 'provider-error' | 'invalid-data' };
const CHUNK = 10;
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
  async function loadBasket(tickers: readonly string[]): Promise<{ levels: DailyClose[] } | ProviderFailure> {
    const series: Record<string, DailyClose[]> = {};
    let reached = false;
    for (let i = 0; i < tickers.length; i += CHUNK) {
      const chunk = tickers.slice(i, i + CHUNK);
      const url = new URL('https://api.twelvedata.com/time_series');
      for (const [key, value] of Object.entries({ symbol: chunk.join(','), interval: '1day', outputsize: '2900', adjust: 'splits', end_date: confirmedSession, apikey: config.apiKey! })) url.searchParams.set(key, value);
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
    return levels.length ? { levels } : { status: 'unavailable', reason: 'invalid-data' };
  }
  // Independent failures: the semiconductor basket never contaminates the large-cap one. Fear is derived from the large-cap basket.
  const large = await loadBasket(lists.nasdaq100), chips = await loadBasket(lists.semiconductors);
  const nas100 = 'levels' in large ? calculateTemperature('nas100', large.levels, confirmedSession) : large;
  const sox = 'levels' in chips ? calculateTemperature('sox', chips.levels, confirmedSession) : chips;
  const vix = 'levels' in large ? calculateVixContext(realizedVolatility(large.levels), confirmedSession) : large;
  return { asOf: confirmedSession, nas100, sox, vix, missing: [...new Set(missing)].sort() };
}
