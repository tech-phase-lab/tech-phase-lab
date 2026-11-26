import overrides from "./stock-splits.json" with { type: "json" };
import { twelveNumber } from "./twelve-data-values.ts";

/** Stock splits (corporate actions) and the per-share numbers they change. Pure apart from `createSplitLoader`, which reads the provider.
 *
 * `date` is the first US trading day on a split-adjusted basis (ET). `ratio` is the number of new shares per old share: 8 for Sandisk's
 * 8-for-1 forward split, 0.125 for a 1-for-8 reverse split. A number written down on a day before `date` (a holding, a reference price, an
 * alert level) is on the old basis: shares × ratio and prices ÷ ratio bring it to today's basis. Values are adjusted when read; nothing
 * stored is rewritten. */
export type StockSplit = { ticker: string; date: string; ratio: number; source?: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (x: unknown): x is string => typeof x === "string" && DAY.test(x) && Number.isFinite(Date.parse(x)) && new Date(`${x}T00:00:00Z`).toISOString().slice(0, 10) === x;
const TICKER = /^[A-Z][A-Z0-9.\-]{0,14}$/;

function readOverrides(value: unknown): StockSplit[] {
  const rows = value && typeof value === "object" && Array.isArray((value as { splits?: unknown }).splits) ? (value as { splits: unknown[] }).splits : [];
  return rows.flatMap(raw => {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    if (typeof row.ticker !== "string" || !TICKER.test(row.ticker) || !isDay(row.date) || typeof row.ratio !== "number" || !Number.isFinite(row.ratio) || row.ratio <= 0 || row.ratio === 1) return [];
    return [{ ticker: row.ticker, date: row.date, ratio: row.ratio, ...(typeof row.source === "string" ? { source: row.source } : {}) }];
  });
}
/** The manual list (lib/research/stock-splits.json). Used everywhere, also when the provider cannot be read. */
export const SPLIT_OVERRIDES: readonly StockSplit[] = Object.freeze(readOverrides(overrides));

const DAY_MS = 86_400_000;
const daysApart = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS;
/** A provider row is taken as a split only when both factors are small whole numbers (at most 50) and the ratio is at least 10% away from 1.
 * Twelve Data also lists spin-off price adjustments as "splits" (HON 1061-for-1000, CMCSA 1067-for-1000, DD 239-for-100, GE 1281-for-1000):
 * they change no share count and are dropped. */
export function isSimpleSplit(from: number, to: number): boolean {
  return Number.isInteger(from) && Number.isInteger(to) && from >= 1 && to >= 1 && from <= 50 && to <= 50 && Math.abs(from / to - 1) >= 0.1;
}
/** One row per event: the same ratio listed twice within 10 days (NVDA 2001-09-12 and 2001-09-17) is one split (the later date is kept). */
function dedupe(rows: StockSplit[]): StockSplit[] {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.filter((row, i) => !sorted.slice(i + 1).some(next => next.ticker === row.ticker && Math.abs(next.ratio - row.ratio) < 1e-9 && daysApart(next.date, row.date) <= 10));
}

export class SplitReadError extends Error {}
/** Twelve Data's /splits answer. Its `from_factor` is the NEW share count and `to_factor` the old one ("8-for-1 split": from 8, to 1;
 * GE's "1-for-8" reverse split: from 1, to 8), so the ratio is from ÷ to. An error answer (a 429 credit limit comes back as a 200 with
 * status "error"), a missing list or another symbol's answer throws: an answer we could not read is never "no splits". */
export function parseTwelveSplits(raw: unknown, ticker: string): StockSplit[] {
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const meta = body.meta && typeof body.meta === "object" ? body.meta as Record<string, unknown> : {};
  if (body.status === "error" || !Array.isArray(body.splits) || (typeof meta.symbol === "string" && meta.symbol.toUpperCase() !== ticker.toUpperCase())) throw new SplitReadError("unreadable");
  const out: StockSplit[] = [];
  for (const item of body.splits) {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const from = twelveNumber(row.from_factor), to = twelveNumber(row.to_factor);
    if (!isDay(row.date) || from === null || to === null || !isSimpleSplit(from, to)) continue;
    out.push({ ticker: ticker.toUpperCase(), date: row.date, ratio: from / to });
  }
  return dedupe(out);
}

/** The provider's rows for one ticker with the manual list laid over them: a manual row replaces a provider row within 10 days of it. */
export function mergeSplits(ticker: string, provider: readonly StockSplit[] = [], manual: readonly StockSplit[] = SPLIT_OVERRIDES): StockSplit[] {
  const own = manual.filter(s => s.ticker === ticker);
  return dedupe([...provider.filter(p => p.ticker === ticker && !own.some(m => daysApart(m.date, p.date) <= 10)), ...own]);
}

/** How many of today's shares one share written down on `basisDay` became by `asOfDay` (1 when no split lies between). A split dated on
 * the basis day itself is taken as already in the written number. */
export function splitFactor(splits: readonly StockSplit[] | undefined, basisDay: string | null | undefined, asOfDay: string): number {
  if (!splits?.length || !basisDay || !isDay(basisDay)) return 1;
  return splits.reduce((factor, s) => s.date > basisDay && s.date <= asOfDay ? factor * s.ratio : factor, 1);
}
/** The splits that `splitFactor` would apply (for a notice on screen). */
export function splitsBetween(splits: readonly StockSplit[] | undefined, basisDay: string | null | undefined, asOfDay: string): StockSplit[] {
  if (!splits?.length || !basisDay || !isDay(basisDay)) return [];
  return splits.filter(s => s.date > basisDay && s.date <= asOfDay);
}
/** Brings a number written down on `basisDay` to `today`. `knownThrough` is the last day the split list is known to be complete for: the ET
 * day before the provider's answer was read (a split dated on the read day may not be listed yet). The basis never moves past it, so a stale
 * or late answer cannot freeze an unadjusted number. Null (the provider failed: manual list only): the basis moves only up to the last split
 * applied, so a provider-only split is still found later. */
export function rebase(splits: readonly StockSplit[] | undefined, basisDay: string, today: string, knownThrough: string | null): { factor: number; basis: string; applied: StockSplit[] } {
  const applied = splitsBetween(splits, basisDay, today);
  const factor = applied.reduce((f, s) => f * s.ratio, 1);
  const reached = applied.length ? applied[applied.length - 1].date : basisDay;
  const known = knownThrough ? (knownThrough < today ? knownThrough : today) : reached;
  return { factor, basis: [basisDay, reached, known].sort().at(-1)!, applied };
}
/** The day before the ET day of `at`: through when a split list read at `at` is complete. */
export function knownThroughDay(at: number | string | Date): string {
  const day = etDay(at);
  return day ? new Date(Date.parse(`${day}T12:00:00Z`) - DAY_MS).toISOString().slice(0, 10) : "";
}

const easternDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
/** The US (ET) calendar day of a moment: the day a split date is compared with. */
export function etDay(at: Date | string | number = Date.now()): string {
  const time = at instanceof Date ? at.getTime() : typeof at === "string" ? Date.parse(at) : at;
  return Number.isFinite(time) ? easternDay.format(time) : "";
}
/** Weekday steps (holidays are not known here): the market day before / after a day. */
export function marketDayShift(day: string, steps: number): string {
  let t = Date.parse(`${day}T12:00:00Z`);
  for (let n = Math.abs(steps); n > 0;) { t += Math.sign(steps) * DAY_MS; const w = new Date(t).getUTCDay(); if (w !== 0 && w !== 6) n--; }
  return new Date(t).toISOString().slice(0, 10);
}

/** "8-for-1" / "1-for-8" / "3-for-2" for a ratio (new shares per old share). */
export function splitLabel(ratio: number): string {
  for (let old = 1; old <= 50; old++) {
    const fresh = ratio * old;
    if (Math.abs(fresh - Math.round(fresh)) < 1e-6 && Math.round(fresh) >= 1) return `${Math.round(fresh)}-for-${old}`;
  }
  return `${Number(ratio.toFixed(4))}-for-1`;
}

type Fetcher = (input: URL, init?: RequestInit) => Promise<Response>;
/** `through`: per ticker the provider answered for, the day its list is complete through (knownThroughDay of the read). */
export type SplitAnswer = { splits: Record<string, StockSplit[]>; through: Record<string, string> };
/** Splits per ticker for a background job or a route: the provider's full history (/splits, range=full; 20 credits a call) with the manual
 * list laid over it. An answer is kept in memory for `ttlMs` (a day by default) with the time it was read; a failed read (429, error body,
 * timeout) is never kept and gives the manual list alone, with no `through`. No key in output. */
export function createSplitLoader(options: { apiKey: string | undefined; request?: Fetcher; baseUrl?: string; ttlMs?: number; now?: () => number;
  /** RESOLUTE's jobs: each 20-credit read is leased and paced first (lib/resolute/twelve-lease.ts); not granted = a failed read. */
  lease?: { take(cost: number, caller: string, maxWaitMs?: number): Promise<boolean>; limited(): void }; leaseWaitMs?: number }) {
  const request = options.request ?? ((input, init) => fetch(input, init));
  const base = options.baseUrl ?? "https://api.twelvedata.com";
  const ttl = options.ttlMs ?? 24 * 3600_000, now = options.now ?? Date.now;
  const memory = new Map<string, { at: number; splits: StockSplit[] }>();
  async function one(ticker: string): Promise<{ at: number; splits: StockSplit[] } | null> {
    const hit = memory.get(ticker);
    if (hit && now() - hit.at < ttl) return hit;
    try {
      if (!options.apiKey || !TICKER.test(ticker)) return null;
      if (options.lease && !await options.lease.take(20, "resolute-splits", options.leaseWaitMs)) return null;
      const url = new URL(`${base}/splits`);
      url.searchParams.set("symbol", ticker); url.searchParams.set("range", "full"); url.searchParams.set("apikey", options.apiKey);
      const response = await request(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000) });
      if (response.status === 429) options.lease?.limited();
      if (response.status !== 200) return null;
      const read = { at: now(), splits: mergeSplits(ticker, parseTwelveSplits(await response.json(), ticker)) };
      memory.set(ticker, read);
      return read;
    } catch {
      return null;
    }
  }
  return async function load(tickers: readonly string[]): Promise<SplitAnswer> {
    const splits: Record<string, StockSplit[]> = {}, through: Record<string, string> = {};
    for (const ticker of [...new Set(tickers)]) {
      const read = await one(ticker);
      if (read) { splits[ticker] = read.splits; through[ticker] = knownThroughDay(read.at); } else splits[ticker] = mergeSplits(ticker, []);
    }
    return { splits, through };
  };
}
export type SplitLoader = ReturnType<typeof createSplitLoader>;
