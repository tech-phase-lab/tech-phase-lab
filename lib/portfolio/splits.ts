import type { Holding } from "./calc.ts";
import { etDay, mergeSplits, parseTwelveSplits, rebase, type StockSplit } from "../research/stock-splits.ts";

/** Stock splits and the holdings they change. Pure: no network, no storage.
 *
 * A lot's numbers are on the basis of its `checkedAt` day (the day it was typed in, read from a screenshot or last brought up to date).
 * They are adjusted when read: shares × ratio and average cost ÷ ratio for every split after that day, so the total cost stays the same.
 * Nothing is rewritten in storage by a split; a lot is written again only when the reader saves (then on the basis it was brought to).
 *
 * Some lots cannot be read safely, and are then shown exactly as stored, never adjusted, re-dated or saved until the reader chooses:
 *  - a lot last written by the old screen (no `basis: 2`) and dated on or after a split the old screen could have applied. Between the
 *    portfolio's launch (2026-11-01, #295) and the split-aware screen, the old screen (2026-11-11, #396) applied Twelve Data splits the wrong
 *    way round (an 8-for-1 divided the shares by 8) and re-dated the lot on every visit, so its numbers may be as stored, pre-split (× ratio)
 *    or wrong-way (× ratio²). Only splits dated after the launch can have been applied (no lot is older), so older splits (NVDA 2007,
 *    GE 2021) never make a lot ambiguous.
 *  - any lot dated from a split's own day to four days after it: a broker screen read then may still show the old numbers.
 * The reader picks the numbers that match the broker today; nothing is guessed from the price, and the readings come in a fixed order. */
export type Split = StockSplit;
export const parseSplits = parseTwelveSplits;
export { mergeSplits };

/** The old screen's lots can only carry splits dated after the portfolio launched and before the split-aware screen replaced it. */
export const LEGACY_SPLITS = { after: "2026-11-01", through: "2026-12-31" } as const;
const BROKER_LAG_DAYS = 4;

export type Applied = { ticker: string; date: string; ratio: number };
/** `splits`: how many of the latest open splits the reading undoes (0 for as stored). */
export type Reading = { kind: "as-stored" | "pre-split" | "wrong-way"; factor: number; splits: number; shares: number; avgCostUsd: number };
/** `split`: the latest open split (the reader's choice is confirmed against it and every earlier one: the chosen numbers are today's). */
export type Ambiguous = { key: string; ticker: string; source?: string; split: Split; splits: Split[]; readings: Reading[] };
export type SplitOptions = {
  /** Per ticker the provider answered for, the day its list is complete through (knownThroughDay). A ticker without it is known only from
   * the manual list: it is adjusted, but its date moves only to the last split applied. Omitted: every ticker given is complete to today. */
  through?: Readonly<Record<string, string | undefined>>;
  /** The day the saved file was last written (its savedAt): an old-screen lot in a file saved on or after a split is ambiguous. */
  savedDay?: string | null;
};
const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const lotKey = (lot: Pick<Holding, "ticker" | "source">) => `${lot.ticker}|${lot.source ?? ""}`;

/** The readings offered, always in this order and never ordered or preselected by price: as stored first, then the lot as it was before
 * the latest one, two, … open splits (× their ratios), then (old-screen lots only) the same splits applied the wrong way round (× ratio²). */
function readings(lot: Holding, open: readonly Split[], legacy: boolean): Reading[] {
  const make = (kind: Reading["kind"], factor: number, splits: number): Reading => ({ kind, factor, splits, shares: round(lot.shares * factor, 6), avgCostUsd: round(lot.avgCostUsd / factor, 6) });
  const latest = [...open].reverse();
  const products = latest.map((_, j) => latest.slice(0, j + 1).reduce((f, x) => f * x.ratio, 1));
  return [make("as-stored", 1, 0), ...products.map((f, j) => make("pre-split", f, j + 1)), ...(legacy ? products.map((f, j) => make("wrong-way", f * f, j + 1)) : [])];
}
/** The open splits that make this lot ambiguous (see above), oldest first, and whether the old screen may have touched it. A split the lot
 * is confirmed against (the reader chose, or this screen adjusted it across that split) is never open again. */
function ambiguity(lot: Holding, list: readonly Split[], basis: string, today: string, savedDay: string | null): { open: Split[]; legacy: boolean } | null {
  const open = list.filter(s => s.date <= today && !(lot.confirmedSplit && lot.confirmedSplit >= s.date));
  if (lot.basis !== 2) {
    // An old-screen lot: dated on or after the split (the old screen re-dated what it changed), or in a file saved on or after it (the
    // paused screen of Nov 21, #735, saved new lots without a date, and the store filled in the previous save's day).
    const legacy = open.filter(s => s.date > LEGACY_SPLITS.after && s.date <= LEGACY_SPLITS.through && (s.date <= basis || (savedDay !== null && s.date <= savedDay)));
    if (legacy.length) return { open: legacy, legacy: true };
  }
  const lag = open.filter(s => s.date <= basis && basis <= addDays(s.date, BROKER_LAG_DAYS));
  return lag.length ? { open: lag, legacy: false } : null;
}

/** The lots on today's basis. A ticker missing from `splits` (the provider failed and the manual list has nothing) is left exactly as it is,
 * date included; an ambiguous lot likewise, and it is listed in `ambiguous` with its readings. Every other lot is brought up to date (see
 * `rebase`), marked `basis: 2` and confirmed against the splits it was adjusted across, so saving the result never applies a split twice
 * and never asks about it again. `baseline` is the basis of a lot without a check date (the previous save's day). The yen cost rate is per
 * dollar and does not change. */
export function adjustForSplits(holdings: readonly Holding[], splits: Readonly<Record<string, readonly Split[] | undefined>>, baseline: string, today: string, options: SplitOptions = {}): { holdings: Holding[]; applied: Applied[]; ambiguous: Ambiguous[] } {
  const applied: Applied[] = [], ambiguous: Ambiguous[] = [];
  const next = holdings.map(lot => {
    const list = splits[lot.ticker];
    if (list === undefined) return lot;
    const since = lot.checkedAt && /^\d{4}-\d{2}-\d{2}$/.test(lot.checkedAt) ? lot.checkedAt : baseline;
    const unsure = ambiguity(lot, list, since, today, options.savedDay ?? null);
    if (unsure) {
      ambiguous.push({ key: lotKey(lot), ticker: lot.ticker, source: lot.source, split: unsure.open[unsure.open.length - 1], splits: unsure.open, readings: readings(lot, unsure.open, unsure.legacy) });
      return lot;
    }
    const through = options.through ? options.through[lot.ticker] ?? null : today;
    const { factor, basis, applied: used } = rebase(list, since, today, through);
    for (const split of used) if (!applied.some(a => a.ticker === lot.ticker && a.date === split.date)) applied.push({ ticker: lot.ticker, date: split.date, ratio: split.ratio });
    const checkedAt = lot.checkedAt && lot.checkedAt > basis ? lot.checkedAt : basis;
    const confirmed = used.length && !(lot.confirmedSplit && lot.confirmedSplit >= used[used.length - 1].date) ? { confirmedSplit: used[used.length - 1].date } : {};
    return { ...lot, ...(factor === 1 ? {} : { shares: round(lot.shares * factor, 6), avgCostUsd: round(lot.avgCostUsd / factor, 6) }), checkedAt, basis: 2 as const, ...confirmed };
  });
  return { holdings: next, applied, ambiguous };
}
/** The reader's choice for an ambiguous lot: its numbers become that reading, dated the latest split it settles (and confirmed against it),
 * so a later split of the ticker, even one while the choice was pending, is still applied. */
export function chooseReading(lots: readonly Holding[], choice: Ambiguous, reading: Reading): Holding[] {
  return lots.map(lot => lotKey(lot) !== choice.key ? lot
    : { ...lot, shares: reading.shares, avgCostUsd: reading.avgCostUsd, checkedAt: choice.split.date, basis: 2 as const, confirmedSplit: choice.split.date });
}
/** The splits known without asking the provider (the manual list), for the held tickers that have any. */
export function knownSplits(tickers: readonly string[]): Record<string, Split[]> {
  return Object.fromEntries(tickers.map(ticker => [ticker, mergeSplits(ticker, [])]).filter(([, list]) => list.length));
}
/** A lot typed in or read from a screenshot now: on today's basis, written by this screen. */
export const fresh = (lot: Holding, today: string): Holding => ({ ...lot, checkedAt: today, basis: 2 });

/** Today's US (ET) day: the day split dates are compared with. */
export const today = (now = Date.now()) => etDay(now);
