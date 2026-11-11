import type { Holding } from "./calc.ts";
import { twelveNumber } from "../research/twelve-data-values.ts";

/** Stock splits and the holdings they change. Pure: no network, no storage. */
export type Split = { date: string; from: number; to: number };
const day = (iso: string) => iso.slice(0, 10);
const isDay = (x: unknown): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x));

/** Twelve Data's /splits answer for one ticker. A malformed row is dropped; a split of 1-for-1 or a non-positive factor is never a split. */
export function parseSplits(raw: unknown, ticker: string): Split[] {
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const meta = body.meta && typeof body.meta === "object" ? body.meta as Record<string, unknown> : {};
  if (body.status === "error" || !Array.isArray(body.splits) || (typeof meta.symbol === "string" && meta.symbol.toUpperCase() !== ticker.toUpperCase())) return [];
  const out: Split[] = [];
  for (const item of body.splits) {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const from = twelveNumber(row.from_factor), to = twelveNumber(row.to_factor);
    if (!isDay(row.date) || from === null || to === null || from <= 0 || to <= 0 || from === to) continue;
    out.push({ date: row.date, from, to });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export type Applied = { ticker: string; date: string; from: number; to: number };
const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;
/** Applies every split that took effect after a lot was last checked (and on or before today). A lot the reader typed in after the split already
 * carries post-split numbers: its check date is later than the split, so nothing is applied to it. The yen cost rate is per dollar and does not change. */
export function applySplits(holdings: readonly Holding[], splits: Readonly<Record<string, readonly Split[] | undefined>>, baseline: string, today: string): { holdings: Holding[]; applied: Applied[] } {
  const applied: Applied[] = [];
  const next = holdings.map(lot => {
    // No answer for this ticker (the read failed): the lot is left as it is and stays unchecked for the next visit.
    if (splits[lot.ticker] === undefined) return lot;
    const since = lot.checkedAt && isDay(lot.checkedAt) ? lot.checkedAt : baseline;
    let shares = lot.shares, cost = lot.avgCostUsd;
    for (const split of splits[lot.ticker] ?? []) {
      if (split.date <= since || split.date > today) continue;
      const factor = split.to / split.from;
      shares *= factor; cost /= factor;
      applied.push({ ticker: lot.ticker, date: split.date, from: split.from, to: split.to });
    }
    return { ...lot, shares: round(shares, 6), avgCostUsd: round(cost, 6), checkedAt: today };
  });
  return { holdings: next, applied };
}
export const today = (now = Date.now()) => day(new Date(now).toISOString());
