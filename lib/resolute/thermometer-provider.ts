import { calculateTemperature, calculateVixContext, validSessionDate, type DailyClose } from './thermometer.ts';

/** Explicit provider identifiers, supplied after checking actual index metadata.
 * No ETF/CFD substitution; symbol guesses must never silently become index data.
 */
export type IndexInstrument = { symbol: string; exchange: string };
export type ThermometerProviderConfig = {
  enabled: boolean; apiKey?: string;
  instruments: { nas100?: IndexInstrument; sox?: IndexInstrument; vix?: IndexInstrument };
};
type ProviderFailure = { status: 'unavailable'; reason: 'not-configured' | 'provider-error' | 'invalid-data' };
export function parseIndexHistory(payload: unknown, expected: IndexInstrument): DailyClose[] | null {
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as Record<string, unknown>;
  const meta = body.meta as Record<string, unknown> | undefined;
  if (body.status !== 'ok' || !meta || meta.symbol !== expected.symbol || meta.exchange !== expected.exchange ||
      meta.interval !== '1day' || typeof meta.type !== 'string' || meta.type.toLowerCase() !== 'index' || !Array.isArray(body.values)) return null;
  const bars: DailyClose[] = [];
  for (const item of body.values) {
    if (!item || typeof item !== 'object') return null;
    const row = item as Record<string, unknown>;
    if (!validSessionDate(row.datetime) || !(typeof row.close === 'number' || typeof row.close === 'string' && /^\d+(\.\d+)?$/.test(row.close))) return null;
    const close = Number(row.close);
    if (!Number.isFinite(close) || close <= 0) return null;
    bars.push({ date: row.datetime, close });
  }
  return bars;
}
/** Server/job entry point. Injected fetch allows all acceptance tests without API calls.
 * No environment lookup, retries, raw-history response, or logging of credentialed URLs.
 * Caller owns session-finality, scheduling and durable caching; this is not a browser endpoint.
 */
export async function collectThermometer(config: ThermometerProviderConfig, confirmedSession: string, fetcher: typeof fetch) {
  const notConfigured: ProviderFailure = { status: 'unavailable', reason: 'not-configured' };
  if (!config.enabled || !config.apiKey) return { asOf: confirmedSession, nas100: notConfigured, sox: notConfigured, vix: notConfigured };
  if (!validSessionDate(confirmedSession)) throw new Error('invalid-confirmed-session');
  async function load(id: 'nas100' | 'sox' | 'vix') {
    const instrument = config.instruments[id];
    if (!instrument?.symbol || !instrument.exchange) return notConfigured;
    const url = new URL('https://api.twelvedata.com/time_series');
    for (const [key, value] of Object.entries({ symbol: instrument.symbol, exchange: instrument.exchange,
      interval: '1day', outputsize: '5000', end_date: confirmedSession, apikey: config.apiKey! })) url.searchParams.set(key, value);
    try {
      const response = await fetcher(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12000) });
      if (!response.ok) return { status: 'unavailable', reason: 'provider-error' } as ProviderFailure;
      const bars = parseIndexHistory(await response.json(), instrument);
      if (!bars) return { status: 'unavailable', reason: 'invalid-data' } as ProviderFailure;
      return id === 'vix' ? calculateVixContext(bars, confirmedSession) : calculateTemperature(id, bars, confirmedSession);
    } catch { return { status: 'unavailable', reason: 'provider-error' } as ProviderFailure; }
  }
  // Independent failures: one unavailable index never contaminates the other.
  const nas100 = await load('nas100'), sox = await load('sox'), vix = await load('vix');
  return { asOf: confirmedSession, nas100, sox, vix };
}
