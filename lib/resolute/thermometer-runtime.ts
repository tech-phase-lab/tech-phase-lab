import { usMarketSession } from '../research/us-market-session.ts';
import { collectThermometer, type ThermometerProviderConfig } from './thermometer-provider.ts';
import { THERMOMETER_VERSION, validSessionDate } from './thermometer.ts';
import { gaugeReading, type ThermometerSnapshot } from './thermometer-view.ts';

/** The calendar is deliberately bounded; no weekday-only guesses beyond its coverage.
 * A close becomes eligible one hour after the regular/shortened session ends.
 * Eligibility is not proof of provider finality: exact closing-bar dates are checked too.
 */
export function thermometerSession(now: Date): string | null {
  if (!Number.isFinite(now.getTime()) || usMarketSession(now) === null) return null;
  const date = (at: Date) => new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
  for (let hour = 1; hour <= 240; hour++) {
    const at = new Date(now.getTime() - hour * 3600000);
    if (usMarketSession(at) === 'post') return date(at);
  }
  return null;
}
export function unavailableSnapshot(asOf: string, reason: string): ThermometerSnapshot {
  const absent = {status:'unavailable' as const, reason};
  return {asOf,nas100:absent,sox:absent,vix:absent};
}
const reasons = new Set(['not-configured','provider-error','invalid-data','insufficient-history','stale-data']);
/** Sanitize persisted JSON, with independent rejection and no extra provider fields. */
export function safeThermometerSnapshot(raw: unknown, expected: string): ThermometerSnapshot {
  const empty = unavailableSnapshot(expected,'invalid-data');
  if (!raw || typeof raw !== 'object' || !validSessionDate(expected)) return empty;
  const source = raw as ThermometerSnapshot;
  if (source.asOf !== expected) return unavailableSnapshot(expected,'stale-data');
  for (const id of ['nas100','sox'] as const) {
    const r = source[id];
    if (r?.status === 'unavailable') { empty[id] = {status:'unavailable',reason:reasons.has(r.reason)?r.reason:'invalid-data'}; continue; }
    const reading = gaugeReading(source,id);
    if (!reading || reading.version !== THERMOMETER_VERSION || !validSessionDate(reading.referenceFrom) || reading.referenceFrom >= expected || !Number.isInteger(reading.observations) || reading.observations < 2400 || reading.drawdownPercent > 0 || reading.drawdownPercent <= -100 || reading.deviationPercent <= -100 || [reading.drawdownPercentile,reading.deviationPercentile].some(v=>!Number.isFinite(v)||v<0||v>100)) continue;
    const {version,index,asOf,referenceFrom,observations,score,band,drawdownPercent,deviationPercent,drawdownPercentile,deviationPercentile} = reading;
    empty[id] = {status:'ready',version,index,asOf,referenceFrom,observations,score,band,drawdownPercent,deviationPercent,drawdownPercentile,deviationPercentile};
  }
  const v = source.vix;
  if (v?.status === 'ready' && v.asOf === expected && Number.isFinite(v.level) && v.level > 0 && Number.isFinite(v.percentile) && v.percentile >= 0 && v.percentile <= 100) empty.vix = {status:'ready',asOf:expected,level:v.level,percentile:v.percentile};
  else if (v?.status === 'unavailable') empty.vix = {status:'unavailable',reason:reasons.has(v.reason)?v.reason:'invalid-data'};
  return empty;
}
export interface ThermometerDatabase {
  query(sql: string, values?: unknown[]): Promise<{rows: Record<string,unknown>[]}>;
}
export async function readThermometer(db: ThermometerDatabase, now: Date): Promise<ThermometerSnapshot> {
  const session = thermometerSession(now);
  if (!session) return unavailableSnapshot('','calendar-unavailable');
  try {
    const result = await db.query('SELECT snapshot FROM resolute_thermometer_snapshots WHERE session_date = $1', [session]);
    const snapshot = result.rows.length ? safeThermometerSnapshot(result.rows[0].snapshot,session) : unavailableSnapshot(session,'stale-data');
    // Expire an open page at the next eligible close (also at calendar coverage end).
    for (let time = Math.floor(now.getTime()/3600000)*3600000+3600000; time <= now.getTime()+240*3600000; time += 3600000) {
      if (thermometerSession(new Date(time)) !== session) return {...snapshot,validUntil:time};
    }
    return unavailableSnapshot(session,'calendar-unavailable');
  } catch { return unavailableSnapshot(session,'storage-unavailable'); }
}
/** A dedicated connection is required. Lock + immutable daily row prevents duplicate
 * provider calls from overlapping workers. A failed fetch is stored, never auto-retried.
 * No credentials/history are persisted. An uncommitted attempt can be retried by a later
 * invocation after a crash; storage failure is never reported as success.
 */
export async function refreshThermometer(db: ThermometerDatabase, config: ThermometerProviderConfig, now: Date, fetcher: typeof fetch) {
  if (!config.enabled || !config.apiKey) return {status:'disabled' as const};
  const session = thermometerSession(now);
  if (!session) return {status:'calendar-unavailable' as const};
  await db.query('BEGIN');
  try {
    await db.query('SELECT pg_advisory_xact_lock(731402, 1)');
    const existing = await db.query('SELECT session_date FROM resolute_thermometer_snapshots WHERE session_date >= $1 LIMIT 1',[session]);
    if (existing.rows.length) { await db.query('COMMIT'); return {status:'already-attempted' as const,asOf:session}; }
    const collected = await collectThermometer(config,session,fetcher);
    const snapshot = safeThermometerSnapshot(collected,session);
    await db.query('INSERT INTO resolute_thermometer_snapshots (session_date, snapshot) VALUES ($1, $2::jsonb)',[session,JSON.stringify(snapshot)]);
    await db.query('COMMIT');
    return {status:'stored' as const,asOf:session};
  } catch { await db.query('ROLLBACK'); throw new Error('thermometer-refresh-failed'); }
}
