import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { unstable_cache } from "next/cache";
import { after } from "next/server";
import { parseUsage, shareInflight } from "./twelve-credit-gate";
import { BACKGROUND_CEILING, COST, USER_SERIES_CEILING, daySlot, hasRoom, hourSlot, weekSlot } from "./twelve-warm-plan";

/** The comparison's shared store of provider data (statistics, price series, statements), kept in the Next.js data cache that every
 * instance reads. Each entry is keyed by ticker and time slot (day, hour or week), so a reader looks at the current and the previous slot and
 * a writer fills the current one; nothing has to be overwritten or invalidated.
 *
 * A read is cache-only unless it runs inside `fetching(...)`: a missing entry then costs nothing and is reported as missing. Only the
 * background job, a background fill after a user's answer, and a user's one-credit price series ever spend credits. */

export type Raw = { payload: unknown; retrievedAt: string };
export type Series = Raw & { adjust: "splits" };
export type Statements = { income: unknown; cashFlow: unknown; retrievedAt: string };

const BASE = () => process.env.TWELVE_DATA_BASE_URL || "https://api.twelvedata.com";
export const providerConfigured = () => !!process.env.TWELVE_DATA_API_KEY;

class CacheMiss extends Error { constructor() { super("cache-miss"); } }
const mode = new AsyncLocalStorage<{ fetch: true }>();
/** Runs `read` with permission to call the provider on a cache miss (the entry is then stored for everyone). */
export const fetching = <T>(read: () => Promise<T>) => mode.run({ fetch: true }, read);

/** unstable_cache keys on the callback's source text, which a new build can change (minified names); a fixed text keeps the shared entries
 * across deployments. A change of shape needs a new name (v2, ...). */
function sharedCache<T>(name: string, revalidateSeconds: number, read: (ticker: string) => Promise<T>) {
  const callback = async (ticker: string, slot: number) => {
    void slot;
    if (!mode.getStore()?.fetch) throw new CacheMiss();
    return read(ticker);
  };
  callback.toString = () => name;
  return unstable_cache(callback, [name], { revalidate: revalidateSeconds });
}

/** One provider call, no retry and no waiting (a busy minute is simply a miss). The key never reaches the browser or the log. */
export async function providerCall(path: string, params: Record<string, string>, timeoutMs = 10_000): Promise<unknown | null> {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) return null;
  const url = new URL(`${BASE()}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("apikey", key);
  let limited = false;
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    const body = await response.json().catch(() => ({})) as { status?: unknown; code?: unknown; message?: unknown };
    if (!response.ok || body?.status === "error") {
      console.warn(`twelve-data ${path} ${params.symbol} ${response.status} ${String(body?.code ?? "")} ${String(body?.message ?? "").slice(0, 160)}`);
      limited = response.status === 429 || body?.code === 429;
      return null;
    }
    return body;
  } catch { console.warn(`twelve-data ${path} ${params.symbol} failed`); return null; }
  finally {
    spent(path === "statistics" ? COST.statistics : path === "income_statement" || path === "cash_flow" ? COST.statements / 2 : COST.series);
    if (limited) { if (meter) meter.used = Math.max(meter.used ?? 0, USER_SERIES_CEILING); else meter = { at: Date.now(), used: USER_SERIES_CEILING }; }
  }
}

/** A refused call (the minute is full) is a miss like any other, but not a sign the symbol is unknown. */
class ProviderLimited extends Error { constructor() { super("provider-limited"); } }
const required = <T>(value: T | null, reason: string): T => {
  if (value !== null) return value;
  throw meter && meter.used !== null && meter.used >= USER_SERIES_CEILING ? new ProviderLimited() : new Error(reason);
};
const stamp = () => new Date().toISOString();

const statisticsDay = sharedCache("comparison-store-statistics-day-v1", 3 * 86400,
  async (ticker): Promise<Raw> => ({ payload: required(await providerCall("statistics", { symbol: ticker }), "statistics-unavailable"), retrievedAt: stamp() }));
const seriesParams = (ticker: string) => ({ symbol: ticker, interval: "1day", outputsize: "100", adjust: "splits" });
const readSeries = async (ticker: string): Promise<Series> => ({ payload: required(await providerCall("time_series", seriesParams(ticker), 4_000), "series-unavailable"), adjust: "splits", retrievedAt: stamp() });
const seriesHour = sharedCache("comparison-store-series-hour-v1", 3 * 3600, readSeries);
const seriesDay = sharedCache("comparison-store-series-day-v1", 3 * 86400, readSeries);
const statementsWeek = sharedCache("comparison-store-statements-week-v1", 21 * 86400, async (ticker): Promise<Statements> => {
  const [income, cashFlow] = await Promise.all([
    providerCall("income_statement", { symbol: ticker, period: "quarterly" }),
    providerCall("cash_flow", { symbol: ticker, period: "quarterly" }),
  ]);
  return { income: required(income, "statements-unavailable"), cashFlow, retrievedAt: stamp() };
});

async function peek<T>(store: (ticker: string, slot: number) => Promise<T>, ticker: string, slots: number[]): Promise<T | null> {
  for (const slot of slots) {
    try { return await store(ticker, slot); } catch (error) { if (!(error instanceof CacheMiss)) console.warn(`comparison store ${ticker}: ${error instanceof Error ? error.message : "unreadable"}`); }
  }
  return null;
}
const running = new Map<string, Promise<unknown>>();
async function fill<T>(name: string, store: (ticker: string, slot: number) => Promise<T>, ticker: string, slot: number): Promise<T | null> {
  try { return await shareInflight(running, `${name}:${ticker}:${slot}`, () => fetching(() => store(ticker, slot))) as T; }
  catch (error) { if (!(error instanceof ProviderLimited)) failedRecently.set(`${name}:${ticker}`, Date.now()); return null; }
}
/** A symbol the provider could not serve is not asked again by this instance for six hours (the background job still tries daily). */
const failedRecently = new Map<string, number>();
const recentlyFailed = (name: string, ticker: string) => Date.now() - (failedRecently.get(`${name}:${ticker}`) ?? 0) < 6 * 3600_000;

// ---- the minute's credit meter (one credit per read; remembered ten seconds, and this instance's own spending is added meanwhile) ----
let meter: { at: number; used: number | null } | null = null;
function spent(credits: number) { if (meter && meter.used !== null) meter.used += credits; }
const meterReads = new Map<string, Promise<number | null>>();
export async function minuteUsage(maxAgeMs = 10_000): Promise<number | null> {
  if (meter && Date.now() - meter.at < maxAgeMs) return meter.used;
  // Companies of one comparison ask together: they share one read.
  return shareInflight(meterReads, "usage", readMeter);
}
async function readMeter(): Promise<number | null> {
  const key = process.env.TWELVE_DATA_API_KEY;
  let used: number | null = null;
  if (key) try {
    const response = await fetch(`${BASE()}/api_usage?apikey=${encodeURIComponent(key)}`, { cache: "no-store", signal: AbortSignal.timeout(2_000) });
    if (response.ok) used = parseUsage(await response.json().catch(() => null));
  } catch { /* unknown */ }
  meter = { at: Date.now(), used: used === null ? null : used + COST.usage };
  return meter.used;
}

// ---- what a user's comparison reads ----
const MAX_STATISTICS_AGE = 36 * 3600_000; // the valuation factor's own limit
/** The stored statistics (forward P/E, market value), today's or yesterday's; never fetched for a user. */
export async function cachedStatistics(ticker: string, now = Date.now()): Promise<Raw | null> {
  const d = daySlot(now);
  const value = await peek(statisticsDay, ticker, [d, d - 1]);
  return value && now - Date.parse(value.retrievedAt) <= MAX_STATISTICS_AGE ? value : null;
}
/** The stored quarterly statements, this week's or last week's; never fetched for a user. */
export async function cachedStatements(ticker: string, now = Date.now()): Promise<Statements | null> {
  const w = weekSlot(now);
  return peek(statementsWeek, ticker, [w, w - 1]);
}
/** The daily price series: this hour's shared copy, else one credit now if the minute has plenty of room (four seconds at most, no wait),
 * else the background job's copy from today or yesterday. */
export async function userSeries(ticker: string, now = Date.now()): Promise<Series | null> {
  const h = hourSlot(now), d = daySlot(now);
  const hot = await peek(seriesHour, ticker, [h, h - 1]);
  if (hot) return hot;
  if (providerConfigured() && !recentlyFailed("series", ticker) && hasRoom(await minuteUsage(), COST.series, USER_SERIES_CEILING, true)) {
    const fresh = await fill("series", seriesHour, ticker, h);
    if (fresh) return fresh;
  }
  return peek(seriesDay, ticker, [d, d - 1]);
}

/** After the answer is sent, fill what this comparison missed (statistics, and statements when the filing could not give every figure), one
 * at a time and only while the minute has room under the background ceiling. Never waits for credits: a full minute leaves it to the daily
 * job or the next request. Cost is per company and slot, shared by everyone, so it does not grow with users. */
export function scheduleFill(ticker: string, wants: { statistics?: boolean; statements?: boolean }) {
  if (!providerConfigured()) return;
  try { after(() => backgroundFill(ticker, wants)); } catch { /* outside a request (tests, scripts) */ }
}
let backgroundChain: Promise<unknown> = Promise.resolve();
export function backgroundFill(ticker: string, wants: { statistics?: boolean; statements?: boolean }, now = Date.now) {
  const job = async () => {
    if (wants.statistics && !recentlyFailed("statistics", ticker) && !await cachedStatistics(ticker, now())
      && hasRoom(await minuteUsage(), COST.statistics, BACKGROUND_CEILING)) await fill("statistics", statisticsDay, ticker, daySlot(now()));
    if (wants.statements && !recentlyFailed("statements", ticker) && !await cachedStatements(ticker, now())
      && hasRoom(await minuteUsage(), COST.statements, BACKGROUND_CEILING)) await fill("statements", statementsWeek, ticker, weekSlot(now()));
  };
  const run = backgroundChain.then(job, job);
  backgroundChain = run.catch(() => undefined);
  return run;
}

// ---- what the background job writes (it checks the meter itself) ----
export const warmStatistics = (ticker: string, now = Date.now()) => fill("statistics", statisticsDay, ticker, daySlot(now));
export const warmSeries = (ticker: string, now = Date.now()) => fill("series-day", seriesDay, ticker, daySlot(now));
export const warmStatements = (ticker: string, now = Date.now()) => fill("statements", statementsWeek, ticker, weekSlot(now));
/** True when this slot already holds the entry (a repeated call in the same minute costs nothing). */
export const hasStatisticsToday = async (ticker: string, now = Date.now()) => !!await peek(statisticsDay, ticker, [daySlot(now)]);
export const hasSeriesToday = async (ticker: string, now = Date.now()) => !!await peek(seriesDay, ticker, [daySlot(now)]);

/** A small shared note per company and week, written by the background job: does its filing leave a figure only the provider's statements can
 * fill? Computed by the caller (the comparison server), stored here so the job checks the filing once a week, not daily. */
export function weeklyNote<T>(name: string, compute: (ticker: string) => Promise<T>) {
  const store = sharedCache(name, 21 * 86400, compute);
  return {
    read: (ticker: string, now = Date.now()) => peek(store, ticker, [weekSlot(now), weekSlot(now) - 1]),
    write: (ticker: string, now = Date.now()) => fill(name, store, ticker, weekSlot(now)),
  };
}
