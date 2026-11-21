import { etDay, isDay, marketDayShift, rebase, type SplitAnswer, type StockSplit } from "../research/stock-splits.ts";
import type { NotificationSettings } from "./notification-settings.ts";

/** RESOLUTE ③ and stock splits. Each reference price carries the US (ET) day it is on (`priceDay`). The provider's closes are split-adjusted
 * from the split day, so a reference from before a split is divided by the ratio when read (SNDK 8-for-1 on 2026-11-20: $700 becomes $87.50;
 * against the $79.24 close that is −9.4%, not −88.7% firing every line). The stored row is not rewritten by a split.
 *
 * The day travels with the price: GET shows the adjusted price with its new day, a PUT keeps the day the screen sent (a screen opened
 * before a split and saved after it still says "before"), an item without one is today's, and the mail stop records the old day before it
 * moves updated_at. Rows from before priceDay existed use their updated_at once. */
type Answer = Pick<SplitAnswer, "splits"> & { complete?: ReadonlySet<string> };
const round = (n: number) => Math.max(0.01, Math.round(n * 100) / 100);

/** Items on today's basis, each with the day it is now on. A symbol the provider did not answer for moves only up to the last split
 * applied from the manual list, so a provider-only split after that is still found later. */
export function adjustWatchItems(settings: NotificationSettings, savedAt: Date | string | null | undefined, answer: Answer, now: Date): NotificationSettings {
  const legacy = savedAt ? etDay(savedAt) : "", today = etDay(now);
  const watchItems = settings.watchItems.map(item => {
    const basis = item.priceDay && isDay(item.priceDay) ? item.priceDay : legacy || today;
    const complete = answer.complete ? answer.complete.has(item.symbol) : true;
    const { factor, basis: next } = rebase(answer.splits[item.symbol], basis, today, complete);
    return { symbol: item.symbol, referencePrice: factor === 1 ? item.referencePrice : round(item.referencePrice / factor), priceDay: next };
  });
  return { ...settings, watchItems };
}
/** Before a write: an item without a day gets `day` (today for a PUT from the screen, the old basis for the mail stop); a day in the future
 * is brought back to today. */
export function stampPriceDays(settings: NotificationSettings, day: string, today: string): NotificationSettings {
  return { ...settings, watchItems: settings.watchItems.map(item => ({ ...item, priceDay: item.priceDay && isDay(item.priceDay) ? (item.priceDay > today ? today : item.priceDay) : day })) };
}
/** Symbols whose split is within one market day of the close being judged (the day before, the day, the day after): the provider may not
 * have adjusted every figure yet, so nothing is judged for them that day. */
export function splitWindowSymbols(splits: Readonly<Record<string, readonly StockSplit[] | undefined>>, marketDate: string): string[] {
  if (!isDay(marketDate)) return [];
  const days = new Set([marketDayShift(marketDate, -1), marketDate, marketDayShift(marketDate, 1)]);
  return Object.entries(splits).filter(([, list]) => list?.some(s => days.has(s.date))).map(([symbol]) => symbol);
}

/** The adjuster the settings store and the alert job use: reads the watched symbols' splits (provider + manual list), then adjusts. */
export function createSettingsSplitAdjuster(load: (symbols: string[]) => Promise<Answer>, clock: () => Date = () => new Date()) {
  return async (settings: NotificationSettings, savedAt: Date | string | null | undefined): Promise<{ settings: NotificationSettings; splits: Answer["splits"] }> => {
    if (!settings.watchItems.length) return { settings, splits: {} };
    const answer = await load(settings.watchItems.map(i => i.symbol));
    return { settings: adjustWatchItems(settings, savedAt, answer, clock()), splits: answer.splits };
  };
}
export type SettingsSplitAdjuster = ReturnType<typeof createSettingsSplitAdjuster>;
