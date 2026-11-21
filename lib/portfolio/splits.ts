import type { Holding } from "./calc.ts";
import { etDay, mergeSplits, parseTwelveSplits, splitFactor, splitsBetween, type StockSplit } from "../research/stock-splits.ts";

/** Stock splits and the holdings they change. Pure: no network, no storage.
 *
 * A lot's numbers are on the basis of its `checkedAt` day (the day it was typed in, read from a screenshot or last brought up to date).
 * They are adjusted when read: shares × ratio and average cost ÷ ratio for every split after that day, so the total cost stays the same.
 * Nothing is rewritten in storage by a split; a lot is written again only when the reader saves (then on today's basis). */
export type Split = StockSplit;
export const parseSplits = parseTwelveSplits;
export { mergeSplits };

export type Applied = { ticker: string; date: string; ratio: number };
const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

/** The lots on `today`'s basis. Tickers missing from `splits` (the read failed and nothing is known) are left as they are; every other lot
 * is brought to today's basis and carries `checkedAt: today`, so saving the result never applies a split twice. `baseline` is the basis of a
 * lot without a check date (the previous save's day). The yen cost rate is per dollar and does not change. */
export function adjustForSplits(holdings: readonly Holding[], splits: Readonly<Record<string, readonly Split[] | undefined>>, baseline: string, today: string): { holdings: Holding[]; applied: Applied[] } {
  const applied: Applied[] = [];
  const next = holdings.map(lot => {
    const list = splits[lot.ticker];
    if (list === undefined) return lot;
    const since = lot.checkedAt && /^\d{4}-\d{2}-\d{2}$/.test(lot.checkedAt) ? lot.checkedAt : baseline;
    const factor = splitFactor(list, since, today);
    for (const split of splitsBetween(list, since, today)) if (!applied.some(a => a.ticker === lot.ticker && a.date === split.date)) applied.push({ ticker: lot.ticker, date: split.date, ratio: split.ratio });
    return factor === 1 ? { ...lot, checkedAt: lot.checkedAt && lot.checkedAt > today ? lot.checkedAt : today } : { ...lot, shares: round(lot.shares * factor, 6), avgCostUsd: round(lot.avgCostUsd / factor, 6), checkedAt: today };
  });
  return { holdings: next, applied };
}
/** The splits known without asking the provider (the manual list), for every held ticker: used before the provider answers or when it cannot. */
export function knownSplits(tickers: readonly string[]): Record<string, Split[]> {
  return Object.fromEntries(tickers.map(ticker => [ticker, mergeSplits(ticker, [])]).filter(([, list]) => list.length));
}

/** Before Nov 21 the screen applied a provider row the wrong way round (it read Twelve Data's from/to as old/new) and saved the result:
 * a 2-for-1 halved the shares. Such a write left a note (`tech-phase:portfolio:split-note`, entries `{ticker,date,from,to}`, no `version`).
 * This finds the lots that note may have changed (same ticker, checked on the note's day) and what they become once put right: the wrong
 * factor (to ÷ from) is undone and the right one (from ÷ to) applied, i.e. shares × (from ÷ to)². Nothing is written: the reader confirms. */
export type LegacyNote = { at: number; applied: { ticker: string; date: string; from: number; to: number }[]; version?: number; resolved?: boolean };
export type Repair = { ticker: string; source?: string; date: string; label: string; shares: number; fixedShares: number; avgCostUsd: number; fixedCost: number };
export function legacyRepairs(lots: readonly Holding[], note: unknown): Repair[] {
  const value = note && typeof note === "object" ? note as Partial<LegacyNote> : null;
  if (!value || value.version !== undefined || value.resolved || typeof value.at !== "number" || !Array.isArray(value.applied)) return [];
  const noteDay = new Date(value.at).toISOString().slice(0, 10);
  const out: Repair[] = [];
  for (const entry of value.applied) {
    if (!entry || typeof entry.ticker !== "string" || !(entry.from > 0) || !(entry.to > 0) || entry.from === entry.to) continue;
    const fix = (entry.from / entry.to) ** 2;
    for (const lot of lots) {
      if (lot.ticker !== entry.ticker || lot.checkedAt !== noteDay) continue;
      out.push({ ticker: lot.ticker, source: lot.source, date: entry.date, label: `${entry.from}:${entry.to}`, shares: lot.shares, fixedShares: round(lot.shares * fix, 6), avgCostUsd: lot.avgCostUsd, fixedCost: round(lot.avgCostUsd / fix, 6) });
    }
  }
  return out;
}
export function applyRepairs(lots: readonly Holding[], repairs: readonly Repair[]): Holding[] {
  return lots.map(lot => {
    const repair = repairs.find(r => r.ticker === lot.ticker && r.source === lot.source && r.shares === lot.shares && r.avgCostUsd === lot.avgCostUsd);
    return repair ? { ...lot, shares: repair.fixedShares, avgCostUsd: repair.fixedCost } : lot;
  });
}

/** Today's US (ET) day: the day split dates are compared with. */
export const today = (now = Date.now()) => etDay(now);
