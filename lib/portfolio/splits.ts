import type { Holding } from "./calc.ts";
import { etDay, mergeSplits, parseTwelveSplits, rebase, type StockSplit } from "../research/stock-splits.ts";

/** Stock splits and the holdings they change. Pure: no network, no storage.
 *
 * A lot's numbers are on the basis of its `checkedAt` day (the day it was typed in, read from a screenshot or last brought up to date).
 * They are adjusted when read: shares × ratio and average cost ÷ ratio for every split after that day, so the total cost stays the same.
 * Nothing is rewritten in storage by a split; a lot is written again only when the reader saves (then on the basis it was brought to). */
export type Split = StockSplit;
export const parseSplits = parseTwelveSplits;
export { mergeSplits };

export type Applied = { ticker: string; date: string; ratio: number };
export type SplitOptions = {
  /** Tickers the provider answered for. A ticker known only from the manual list is adjusted, but its date moves only to the last split
   * applied, never to today. Omitted: every ticker given is complete. */
  complete?: ReadonlySet<string>;
  /** Current (split-adjusted) prices, to tell which basis a lot checked on a split's own day is on. */
  prices?: Readonly<Record<string, number | null | undefined>>;
};
const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;
const dayBefore = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** A lot checked on a split's own day is ambiguous: an old screen stamped the UTC day (an evening in the US before it) and a broker screen
 * read before the open still shows the old numbers. The current price decides: average cost ÷ price nearer the ratio than 1 (in log terms,
 * at least √ratio for a forward split) is the old basis. Without a price the answer is null and the lot is left as it is. */
function sameDayIsOld(lot: Holding, split: Split, price: number | null | undefined): boolean | null {
  if (!(typeof price === "number" && price > 0)) return null;
  const q = lot.avgCostUsd / price;
  return split.ratio > 1 ? q >= Math.sqrt(split.ratio) : q <= Math.sqrt(split.ratio);
}

/** The lots on today's basis. A ticker missing from `splits` (the provider failed and the manual list has nothing) is left exactly as it is,
 * date included. Every other lot is brought up to date (see `rebase`), so saving the result never applies a split twice. `baseline` is the
 * basis of a lot without a check date (the previous save's day). The yen cost rate is per dollar and does not change. */
export function adjustForSplits(holdings: readonly Holding[], splits: Readonly<Record<string, readonly Split[] | undefined>>, baseline: string, today: string, options: SplitOptions = {}): { holdings: Holding[]; applied: Applied[] } {
  const applied: Applied[] = [];
  const next = holdings.map(lot => {
    const list = splits[lot.ticker];
    if (list === undefined) return lot;
    let since = lot.checkedAt && /^\d{4}-\d{2}-\d{2}$/.test(lot.checkedAt) ? lot.checkedAt : baseline;
    const sameDay = list.find(s => s.date === since && s.date <= today);
    if (sameDay) {
      const old = sameDayIsOld(lot, sameDay, options.prices?.[lot.ticker]);
      if (old === null) return lot;
      if (old) since = dayBefore(since);
    }
    const complete = options.complete ? options.complete.has(lot.ticker) : true;
    const { factor, basis, applied: used } = rebase(list, since, today, complete);
    for (const split of used) if (!applied.some(a => a.ticker === lot.ticker && a.date === split.date)) applied.push({ ticker: lot.ticker, date: split.date, ratio: split.ratio });
    const checkedAt = lot.checkedAt && lot.checkedAt > basis ? lot.checkedAt : basis;
    return factor === 1 ? (checkedAt === lot.checkedAt ? lot : { ...lot, checkedAt }) : { ...lot, shares: round(lot.shares * factor, 6), avgCostUsd: round(lot.avgCostUsd / factor, 6), checkedAt };
  });
  return { holdings: next, applied };
}
/** The splits known without asking the provider (the manual list), for the held tickers that have any. */
export function knownSplits(tickers: readonly string[]): Record<string, Split[]> {
  return Object.fromEntries(tickers.map(ticker => [ticker, mergeSplits(ticker, [])]).filter(([, list]) => list.length));
}

/** Before Nov 21 the screen applied a provider row the wrong way round (it read Twelve Data's from/to as old/new) and saved the result: an
 * 8-for-1 divided the shares by 8 and multiplied the cost by 8, so the lot is off by ratio² against the truth, and it rewrote the check date
 * on every later visit, so the date proves nothing. Such a lot is found by its numbers (one row per lot, per broker and ticker):
 *  - it claims to be on the new basis (checked on or after a split of its ticker) and was not adjusted now;
 *  - average cost ÷ current price is past the ratio (a correct lot would have lost 87.5% on an 8-for-1);
 *  - shares × ratio² is a whole number, and the shares are not whole or the cost ÷ price is past ratio^1.5.
 * A lot consistent with post-split prices is never listed. Nothing is written: the reader chooses per lot. */
export type Repair = { key: string; ticker: string; source?: string; date: string; ratio: number; shares: number; fixedShares: number; avgCostUsd: number; fixedCost: number };
export const lotKey = (lot: Pick<Holding, "ticker" | "source" | "shares" | "avgCostUsd">) => `${lot.ticker}|${lot.source ?? ""}|${lot.shares}|${lot.avgCostUsd}`;
const whole = (n: number) => Math.abs(n - Math.round(n)) < 1e-6 * Math.max(1, Math.abs(n));
export function invertedLots(lots: readonly Holding[], splits: Readonly<Record<string, readonly Split[] | undefined>>, prices: Readonly<Record<string, number | null | undefined>>, kept: ReadonlySet<string> = new Set()): Repair[] {
  const out: Repair[] = [];
  for (const lot of lots) {
    const price = prices[lot.ticker], list = splits[lot.ticker];
    if (!list?.length || !(typeof price === "number" && price > 0) || !lot.checkedAt || kept.has(lotKey(lot)) || out.some(r => r.key === lotKey(lot))) continue;
    const q = lot.avgCostUsd / price;
    const split = [...list].reverse().find(s => {
      if (s.date > lot.checkedAt!) return false;
      const r = s.ratio, past = r > 1 ? q >= r : q <= r, far = r > 1 ? q >= r ** 1.5 : q <= r ** 1.5;
      return past && whole(lot.shares * r * r) && (!whole(lot.shares) || far);
    });
    if (!split) continue;
    const fix = split.ratio ** 2;
    out.push({ key: lotKey(lot), ticker: lot.ticker, source: lot.source, date: split.date, ratio: split.ratio, shares: lot.shares, fixedShares: round(lot.shares * fix, 6), avgCostUsd: lot.avgCostUsd, fixedCost: round(lot.avgCostUsd / fix, 6) });
  }
  return out;
}
/** The chosen repairs written into the lots (now on today's basis). Every other lot is returned unchanged. */
export function applyRepairs(lots: readonly Holding[], repairs: readonly Repair[], today: string): Holding[] {
  return lots.map(lot => {
    const repair = repairs.find(r => r.key === lotKey(lot));
    return repair ? { ...lot, shares: repair.fixedShares, avgCostUsd: repair.fixedCost, checkedAt: today } : lot;
  });
}

/** Today's US (ET) day: the day split dates are compared with. */
export const today = (now = Date.now()) => etDay(now);
