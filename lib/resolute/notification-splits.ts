import { etDay, splitFactor, type StockSplit } from "../research/stock-splits.ts";
import type { NotificationSettings } from "./notification-settings.ts";

/** RESOLUTE ③: a reference price typed in before a stock split is on the old basis, while the provider's closes are split-adjusted from the
 * split day (SNDK 8-for-1 from 2026-11-20: a $700 reference against a $79 close would read as an 89% drop and fire every line). The
 * reference is divided by the ratio of each split after the day the settings were saved (ET), when read; the stored row is not rewritten.
 * The lines are percentages of the reference, so they move with it. Rounded to cents (the settings' own precision), never below $0.01. */
export function adjustWatchItems(settings: NotificationSettings, savedAt: Date | string | null | undefined, splits: Readonly<Record<string, readonly StockSplit[] | undefined>>, now: Date): NotificationSettings {
  const basis = savedAt ? etDay(savedAt) : "";
  if (!basis) return settings;
  const today = etDay(now);
  let changed = false;
  const watchItems = settings.watchItems.map(item => {
    const factor = splitFactor(splits[item.symbol], basis, today);
    if (factor === 1) return item;
    changed = true;
    return { ...item, referencePrice: Math.max(0.01, Math.round(item.referencePrice / factor * 100) / 100) };
  });
  return changed ? { ...settings, watchItems } : settings;
}

/** The adjuster the settings store and the alert job use: reads the watched symbols' splits (provider + manual list), then adjusts. */
export function createSettingsSplitAdjuster(load: (symbols: string[]) => Promise<Record<string, StockSplit[]>>, clock: () => Date = () => new Date()) {
  return async (settings: NotificationSettings, savedAt: Date | string | null | undefined): Promise<NotificationSettings> => {
    if (!savedAt || !settings.watchItems.length) return settings;
    return adjustWatchItems(settings, savedAt, await load(settings.watchItems.map(i => i.symbol)), clock());
  };
}
export type SettingsSplitAdjuster = ReturnType<typeof createSettingsSplitAdjuster>;
