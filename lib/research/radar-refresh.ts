import type { RadarFacts } from "./radar-facts.ts";
import { REVIEW_ABOVE, radarGenres } from "./radar.ts";
import { toRow, type StoredRow } from "./radar-store.ts";

/** The Financial Radar's daily refresh (owner decision, Nov 15): every company of every genre is calculated again from its SEC filing
 * at fixed times, so the first visitor after a filing never sees the old numbers. The Railway monitor calls
 * app/api/research/radar/refresh twice a day and follows the cursor until the whole list is done. A calculation that fails is never
 * saved, so the last good value stays. */

/** Stop starting new companies after this long, so one call (and its last company and saving) ends inside the route's 60 seconds. */
export const REFRESH_BUDGET_MS = 30_000;
/** At least this long between two SEC requests: at most four a second, well under the SEC's fair-access limit of ten. */
export const SEC_SPACING_MS = 250;

export type RefreshItem = { genre: string; ticker: string };
/** Every genre's companies in a fixed order; the cursor is a position in this list. */
export const refreshQueue = (): RefreshItem[] => radarGenres.flatMap(genre => genre.tickers.map(ticker => ({ genre: genre.id, ticker })));

/** The position to start from: 0 when absent, null when it is not a position in the list (the caller answers 400). */
export function parseCursor(raw: string | null, total = refreshQueue().length): number | null {
  if (raw === null || raw === "") return 0;
  if (!/^\d{1,4}$/.test(raw)) return null;
  const value = Number(raw);
  return value < total ? value : null;
}

export type RefreshDeps = {
  load: (ticker: string) => Promise<RadarFacts>;
  save: (row: StoredRow) => Promise<boolean>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  budgetMs?: number;
  spacingMs?: number;
};
export type RefreshReport = { from: number; next: number | null; done: boolean; total: number; refreshed: number; live: number; failed: number; failures: string[]; secRequests: number };

/** Calculates and saves the companies from `start` on until the time budget is used (always at least one, so every call moves on). */
export async function refreshChunk(start: number, deps: RefreshDeps): Promise<RefreshReport> {
  const queue = refreshQueue();
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const budget = deps.budgetMs ?? REFRESH_BUDGET_MS, spacing = deps.spacingMs ?? SEC_SPACING_MS;
  const started = now();
  const facts = new Map<string, RadarFacts>(); // a company listed in two genres is read once per call
  const failures: string[] = [];
  let refreshed = 0, live = 0, secRequests = 0, lastRequest: number | null = null, index = start;
  for (; index < queue.length; index++) {
    if (index > start && now() - started >= budget) break;
    const { genre, ticker } = queue[index];
    let value = facts.get(ticker);
    if (!value) {
      if (lastRequest !== null) { const wait = spacing - (now() - lastRequest); if (wait > 0) await sleep(wait); }
      lastRequest = now(); secRequests++;
      try { value = await deps.load(ticker); } catch { value = { latest: null, previous: null, reason: "unavailable" }; }
      facts.set(ticker, value);
    }
    // A company without revenue is never stored (its figure is a stand-in): the radar calculates it live, so it is not a failure.
    if (!value.reason && value.latest?.noRevenue) { live++; continue; }
    const row = toRow(genre, ticker, value, now(), REVIEW_ABOVE);
    let saved = false;
    if (row) { try { saved = await deps.save(row); } catch { saved = false; } }
    if (saved) refreshed++; else failures.push(`${genre}:${ticker}`);
  }
  const done = index >= queue.length;
  return { from: start, next: done ? null : index, done, total: queue.length, refreshed, live, failed: failures.length, failures, secRequests };
}
