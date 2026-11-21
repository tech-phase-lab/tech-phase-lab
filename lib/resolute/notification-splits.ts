import { etDay, isDay, marketDayShift, rebase, type SplitAnswer, type StockSplit } from "../research/stock-splits.ts";
import type { NotificationSettings } from "./notification-settings.ts";

/** RESOLUTE ③ and stock splits. Each reference price carries the US (ET) day it is on (`priceDay`). The provider's closes are split-adjusted
 * from the split day, so a reference from before a split is divided by the ratio when read (SNDK 8-for-1 on 2026-11-20: $700 becomes $87.50;
 * against the $79.24 close that is −9.4%, not −88.7% firing every line). The stored row is not rewritten by a split.
 *
 * The day travels with the price: GET shows the adjusted price with its new day, a PUT keeps the day the screen sent (a screen opened
 * before a split and saved after it still says "before"); an item sent without a day keeps the stored day when its symbol and price are
 * unchanged (an old screen), and only a new or changed price is today's; the mail stop records the old day before it moves updated_at.
 * Rows from before priceDay existed use their updated_at. */
type Answer = Pick<SplitAnswer, "splits"> & { through?: Readonly<Record<string, string | undefined>> };
const round = (n: number) => Math.max(0.01, Math.round(n * 100) / 100);
const legacyDay = (savedAt: Date | string | null | undefined) => savedAt ? etDay(savedAt) : "";

/** Items on today's basis, each with the day it is now on. The day never moves past the day the provider's list is complete through, and
 * for a symbol the provider did not answer for only up to the last split applied from the manual list. `through` omitted: complete. */
export function adjustWatchItems(settings: NotificationSettings, savedAt: Date | string | null | undefined, answer: Answer, now: Date): NotificationSettings {
  const legacy = legacyDay(savedAt), today = etDay(now);
  const watchItems = settings.watchItems.map(item => {
    const basis = item.priceDay && isDay(item.priceDay) ? item.priceDay : legacy || today;
    const through = answer.through ? answer.through[item.symbol] ?? null : today;
    const { factor, basis: next } = rebase(answer.splits[item.symbol], basis, today, through);
    return { symbol: item.symbol, referencePrice: factor === 1 ? item.referencePrice : round(item.referencePrice / factor), priceDay: next };
  });
  return { ...settings, watchItems };
}
/** Before a write: every item gets a day. One sent with a day keeps it (a day in the future is brought back to today). One sent without a day
 * keeps the stored item's day when the symbol and price are the same as stored (an old screen still open: its price is the stored one), and
 * otherwise is `day` (a price typed now). */
export function stampPriceDays(settings: NotificationSettings, day: string, today: string, stored?: { settings: NotificationSettings; savedAt: Date | string | null | undefined }): NotificationSettings {
  const legacy = stored ? legacyDay(stored.savedAt) : "";
  return { ...settings, watchItems: settings.watchItems.map(item => {
    if (item.priceDay && isDay(item.priceDay)) return { ...item, priceDay: item.priceDay > today ? today : item.priceDay };
    const same = stored?.settings.watchItems.find(old => old.symbol === item.symbol && old.referencePrice === item.referencePrice);
    const kept = same ? (same.priceDay && isDay(same.priceDay) ? same.priceDay : legacy) : "";
    return { ...item, priceDay: kept || day };
  }) };
}
/** Before a write: an item the screen sends back exactly as GET showed it (the stored price converted across a split) is stored as the
 * original price with its original day, so a split never rewrites a stored price and the rule key (notification-rule-key.ts) never moves
 * because of one. `shown` is GET's version of `stored` (adjustWatchItems). */
export function keepStoredOriginals(sent: NotificationSettings, stored: { settings: NotificationSettings; savedAt: Date | string | null | undefined }, shown: NotificationSettings | null): NotificationSettings {
  if (!shown) return sent;
  const legacy = legacyDay(stored.savedAt);
  return { ...sent, watchItems: sent.watchItems.map(item => {
    const asShown = shown.watchItems.find(s => s.symbol === item.symbol && s.referencePrice === item.referencePrice && s.priceDay === item.priceDay);
    const original = asShown && stored.settings.watchItems.find(s => s.symbol === item.symbol);
    if (!original) return item;
    const day = original.priceDay && isDay(original.priceDay) ? original.priceDay : legacy;
    return day ? { symbol: item.symbol, referencePrice: original.referencePrice, priceDay: day } : item;
  }) };
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
