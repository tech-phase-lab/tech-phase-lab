import { usMarketSession } from '../research/us-market-session.ts';
import { collectThermometer, type ThermometerProviderConfig } from './thermometer-provider.ts';
import { THERMOMETER_VERSION, validSessionDate } from './thermometer.ts';
import { gaugeReading, type DailyMoveReading, type ShockReadingView, type ThermometerSnapshot } from './thermometer-view.ts';
import type { BigDrop, SimilarDay, SimilarHistory } from './similar-days.ts';

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
  const moves = safeMoves(source.moves, expected), shock = safeShock((source as {shock?: unknown}).shock, expected), trail = safeTrail(source.trail, expected);
  const history = safePair(source.history, h => safeHistory(h, expected)), drops = safePair(source.drops, d => safeDrops(d, expected));
  return {...empty, ...(moves ? {moves} : {}), ...(shock ? {shock} : {}), ...(trail ? {trail} : {}), ...(history ? {history} : {}), ...(drops ? {drops} : {})};
}
/** Only a move dated on the snapshot's own session, with a plausible earlier previous close, is kept. */
function safeMove(raw: unknown, expected: string): DailyMoveReading | null {
  const m = raw as DailyMoveReading | null | undefined;
  if (!m || typeof m !== 'object' || m.date !== expected || !validSessionDate(m.previousDate) || m.previousDate >= expected) return null;
  const days = (Date.parse(expected) - Date.parse(m.previousDate)) / 86400000;
  if (days > 7 || typeof m.changePercent !== 'number' || !Number.isFinite(m.changePercent) || Math.abs(m.changePercent) >= 100) return null;
  return {date: m.date, previousDate: m.previousDate, changePercent: m.changePercent};
}
export function safeMoves(raw: unknown, expected: string): ThermometerSnapshot['moves'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = raw as Record<string, unknown>;
  return {nas100: safeMove(source.nas100, expected), sox: safeMove(source.sox, expected)};
}
/** The home chart line: at most 70 ascending sessions, positive levels, the last one on the snapshot's own session. */
function safeLine(raw: unknown, expected: string): {date: string; close: number}[] | null {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 70) return null;
  const out: {date: string; close: number}[] = [];
  for (const bar of raw) {
    const b = bar as {date?: unknown; close?: unknown};
    if (!b || !validSessionDate(b.date) || typeof b.close !== 'number' || !Number.isFinite(b.close) || b.close <= 0 || b.close > 1e7) return null;
    if (out.length && b.date <= out[out.length - 1].date) return null;
    out.push({date: b.date, close: b.close});
  }
  return out[out.length - 1].date === expected ? out : null;
}
export function safeTrail(raw: unknown, expected: string): ThermometerSnapshot['trail'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = raw as Record<string, unknown>, nas100 = safeLine(source.nas100, expected), sox = safeLine(source.sox, expected);
  return nas100 || sox ? {nas100, sox} : undefined;
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
    // The stocks' own moves (single-company Shock Gauge news) are stored beside the snapshot but never served (readThermometer
    // re-sanitizes with safeThermometerSnapshot, which drops them).
    const stocks = safeShockStocks((collected as {shockStocks?: unknown}).shockStocks, session);
    const snapshot = {...safeThermometerSnapshot(collected,session), ...(stocks ? {shockStocks: stocks} : {})};
    await db.query('INSERT INTO resolute_thermometer_snapshots (session_date, snapshot) VALUES ($1, $2::jsonb)',[session,JSON.stringify(snapshot)]);
    await db.query('COMMIT');
    return {status:'stored' as const,asOf:session};
  } catch { await db.query('ROLLBACK'); throw new Error('thermometer-refresh-failed'); }
}

const finite = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const count = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 500;
/** One basket's shock reading for `date`: its move (as safeMove), typical move, and constituent counts. */
function safeShockReading(raw: unknown, date: string): ShockReadingView | null {
  const m = safeMove(raw, date), x = raw as ShockReadingView;
  if (!m || !finite(x.typicalPercent, 0.01, 50) || !count(x.up) || !count(x.down) || !count(x.total) || x.total < 10 || x.up + x.down > x.total) return null;
  return {...m, typicalPercent: x.typicalPercent, up: x.up, down: x.down, total: x.total};
}
/** Each rostered stock's own move per session (single-company news): at most 5 sessions on or before the snapshot's own,
 * each move dated on its session with an earlier previous close at most 7 days before and a plausible typical move. */
export type ShockStocks = Record<string, Record<string, {date: string; previousDate: string; changePercent: number; typicalPercent: number}>>;
export function safeShockStocks(raw: unknown, expected: string): ShockStocks | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: ShockStocks = {};
  for (const [date, value] of Object.entries(raw as Record<string, unknown>).slice(-5)) {
    if (!validSessionDate(date) || date > expected || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    const day: ShockStocks[string] = {};
    for (const [ticker, m] of Object.entries(value as Record<string, unknown>).slice(0, 300)) {
      const move = /^[A-Z][A-Z0-9.]{0,9}$/.test(ticker) ? safeMove(m, date) : null, typical = (m as {typicalPercent?: unknown})?.typicalPercent;
      if (move && finite(typical, 0.01, 50)) day[ticker] = {...move, typicalPercent: typical};
    }
    if (Object.keys(day).length) out[date] = day;
  }
  return Object.keys(out).length ? out : undefined;
}
/** The snapshot's shock map: at most 15 sessions, each dated on or before the snapshot's own session. */
export function safeShock(raw: unknown, expected: string): ThermometerSnapshot['shock'] | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: NonNullable<ThermometerSnapshot['shock']> = {};
  for (const [date, value] of Object.entries(raw as Record<string, unknown>).slice(-15)) {
    if (!validSessionDate(date) || date > expected || !value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>, f = v.fear as {date?: unknown; level?: unknown; previousLevel?: unknown} | null;
    out[date] = {nas100: safeShockReading(v.nas100, date), sox: safeShockReading(v.sox, date),
      fear: f && f.date === date && finite(f.level, 0.01, 1000) && finite(f.previousLevel, 0.01, 1000) ? {date, level: f.level, previousLevel: f.previousLevel} : null};
  }
  return Object.keys(out).length ? out : undefined;
}

function safePair<T>(raw: unknown, check: (v: unknown) => T | null): {nas100: T | null; sox: T | null} | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const v = raw as Record<string, unknown>, out = {nas100: check(v.nas100), sox: check(v.sox)};
  return out.nas100 || out.sox ? out : undefined;
}
const dayCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 4000;
const pct = (v: unknown, nullable = false): v is number | null => nullable && v === null || finite(v, -99.99, 1000);
function safeSimilarDay(raw: unknown, session: string): SimilarDay | null {
  const d = raw as SimilarDay;
  if (!d || typeof d !== 'object' || !validSessionDate(d.date) || d.date >= session || !pct(d.changePercent) || !pct(d.monthAfterPercent, true)) return null;
  if (d.recoveredOn === null ? d.days !== null : !(validSessionDate(d.recoveredOn) && d.recoveredOn > d.date && d.recoveredOn <= session && dayCount(d.days))) return null;
  return {date: d.date, changePercent: d.changePercent, recoveredOn: d.recoveredOn, days: d.days, monthAfterPercent: d.monthAfterPercent};
}
/** 「今日と似た日」 for the snapshot's own session only; every count consistent with the others. */
export function safeHistory(raw: unknown, expected: string): SimilarHistory | null {
  const h = raw as SimilarHistory;
  if (!h || typeof h !== 'object' || h.date !== expected || !validSessionDate(h.from) || h.from >= expected || !(h.direction === 'down' || h.direction === 'up') ||
      !pct(h.changePercent) || (h.direction === 'down') !== (h.changePercent < 0) || !pct(h.low) || !pct(h.high) || h.low > h.high) return null;
  const counts = [h.count, h.recovered, h.monthCount, h.higherAfterMonth];
  if (!counts.every(c => Number.isInteger(c) && c >= 0 && c <= 3000) || h.recovered > h.count || h.monthCount > h.count || h.higherAfterMonth > h.monthCount) return null;
  if ((h.recovered === 0) !== (h.minDays === null && h.maxDays === null) || h.recovered > 0 && !(dayCount(h.minDays) && dayCount(h.maxDays) && h.minDays <= h.maxDays)) return null;
  if ((h.monthCount === 0) !== (h.monthMin === null && h.monthMax === null) || h.monthCount > 0 && !(pct(h.monthMin) && pct(h.monthMax) && h.monthMin! <= h.monthMax!)) return null;
  if (!Array.isArray(h.recent) || h.recent.length > 3 || h.recent.length > h.count) return null;
  const recent = h.recent.map(d => safeSimilarDay(d, expected));
  if (recent.some(d => !d)) return null;
  const {date, changePercent, direction, low, high, from, count, recovered, minDays, maxDays, monthCount, higherAfterMonth, monthMin, monthMax} = h;
  return {date, changePercent, direction, low, high, from, count, recovered, minDays, maxDays, monthCount, higherAfterMonth, monthMin, monthMax, recent: recent as SimilarDay[]};
}
/** The past big falls: dated before the session, in order, each recovered after it began (or not yet). */
export function safeDrops(raw: unknown, expected: string): BigDrop[] | null {
  if (!Array.isArray(raw) || raw.length > 12) return null;
  const out: BigDrop[] = [];
  for (const item of raw) {
    const d = item as BigDrop;
    if (!d || typeof d !== 'object' || !validSessionDate(d.peak) || !validSessionDate(d.trough) || d.peak >= d.trough || d.trough > expected) return null;
    if (d.recoveredOn === null ? d.days !== null : !(validSessionDate(d.recoveredOn) && d.recoveredOn > d.trough && d.recoveredOn <= expected && dayCount(d.days))) return null;
    if (out.length && out[out.length - 1].peak >= d.peak) return null;
    out.push({peak: d.peak, trough: d.trough, recoveredOn: d.recoveredOn, days: d.days});
  }
  return out;
}
