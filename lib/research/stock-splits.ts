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
const isDay = (x: unknown): x is string => typeof x === "string" && DAY.test(x) && Number.isFinite(Date.parse(x)) && new Date(`${x}T00:00:00Z`).toISOString().slice(0, 10) === x;
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

/** Twelve Data's /splits answer. Its `from_factor` is the NEW share count and `to_factor` the old one ("8-for-1 split": from 8, to 1;
 * GE's "1-for-8" reverse split: from 1, to 8), so the ratio is from ÷ to. Malformed rows, 1-for-1 rows and another symbol's answer are dropped. */
export function parseTwelveSplits(raw: unknown, ticker: string): StockSplit[] {
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const meta = body.meta && typeof body.meta === "object" ? body.meta as Record<string, unknown> : {};
  if (body.status === "error" || !Array.isArray(body.splits) || (typeof meta.symbol === "string" && meta.symbol.toUpperCase() !== ticker.toUpperCase())) return [];
  const out: StockSplit[] = [];
  for (const item of body.splits) {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const from = twelveNumber(row.from_factor), to = twelveNumber(row.to_factor);
    if (!isDay(row.date) || from === null || to === null || from <= 0 || to <= 0 || from === to) continue;
    out.push({ ticker: ticker.toUpperCase(), date: row.date, ratio: from / to });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const daysApart = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
/** The provider's rows for one ticker with the manual list laid over them: a manual row replaces a provider row within 5 days of it. */
export function mergeSplits(ticker: string, provider: readonly StockSplit[] = [], manual: readonly StockSplit[] = SPLIT_OVERRIDES): StockSplit[] {
  const own = manual.filter(s => s.ticker === ticker);
  return [...provider.filter(p => p.ticker === ticker && !own.some(m => daysApart(m.date, p.date) <= 5)), ...own].sort((a, b) => a.date.localeCompare(b.date));
}

/** How many of today's shares one share written down on `basisDay` became by `asOfDay` (1 when no split lies between). A split dated on
 * the basis day itself is already in the written number (the number was taken on the adjusted basis). */
export function splitFactor(splits: readonly StockSplit[] | undefined, basisDay: string | null | undefined, asOfDay: string): number {
  if (!splits?.length || !basisDay || !isDay(basisDay)) return 1;
  return splits.reduce((factor, s) => s.date > basisDay && s.date <= asOfDay ? factor * s.ratio : factor, 1);
}
/** The splits that `splitFactor` would apply (for a notice on screen). */
export function splitsBetween(splits: readonly StockSplit[] | undefined, basisDay: string | null | undefined, asOfDay: string): StockSplit[] {
  if (!splits?.length || !basisDay || !isDay(basisDay)) return [];
  return splits.filter(s => s.date > basisDay && s.date <= asOfDay);
}

const easternDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
/** The US (ET) calendar day of a moment: the day a split date is compared with. */
export function etDay(at: Date | string | number = Date.now()): string {
  const time = at instanceof Date ? at.getTime() : typeof at === "string" ? Date.parse(at) : at;
  return Number.isFinite(time) ? easternDay.format(time) : "";
}

/** "8-for-1" / "1-for-8" / "3-for-2" for a ratio (new shares per old share). */
export function splitLabel(ratio: number): string {
  for (let old = 1; old <= 1000; old++) {
    const fresh = ratio * old;
    if (Math.abs(fresh - Math.round(fresh)) < 1e-6) return `${Math.round(fresh)}-for-${old}`;
  }
  return `${ratio}-for-1`;
}

type Fetcher = (input: URL, init?: RequestInit) => Promise<Response>;
/** Splits per ticker for a background job or a route: the provider's full history (/splits, range=full) with the manual list laid over
 * it. Kept in memory for `ttlMs`; a failed read is not kept and gives the manual list alone, so a known split is never missed. No key in output. */
export function createSplitLoader(options: { apiKey: string | undefined; request?: Fetcher; baseUrl?: string; ttlMs?: number; now?: () => number }) {
  const request = options.request ?? ((input, init) => fetch(input, init));
  const base = options.baseUrl ?? "https://api.twelvedata.com";
  const ttl = options.ttlMs ?? 6 * 3600_000, now = options.now ?? Date.now;
  const memory = new Map<string, { at: number; splits: StockSplit[] }>();
  async function one(ticker: string): Promise<StockSplit[]> {
    const hit = memory.get(ticker);
    if (hit && now() - hit.at < ttl) return hit.splits;
    try {
      if (!options.apiKey || !TICKER.test(ticker)) throw new Error("unavailable");
      const url = new URL(`${base}/splits`);
      url.searchParams.set("symbol", ticker); url.searchParams.set("range", "full"); url.searchParams.set("apikey", options.apiKey);
      const response = await request(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000) });
      if (response.status !== 200) throw new Error("unavailable");
      const splits = mergeSplits(ticker, parseTwelveSplits(await response.json(), ticker));
      memory.set(ticker, { at: now(), splits });
      return splits;
    } catch {
      return mergeSplits(ticker, []);
    }
  }
  return async function load(tickers: readonly string[]): Promise<Record<string, StockSplit[]>> {
    const out: Record<string, StockSplit[]> = {};
    for (const ticker of [...new Set(tickers)]) out[ticker] = await one(ticker);
    return out;
  };
}
export type SplitLoader = ReturnType<typeof createSplitLoader>;
