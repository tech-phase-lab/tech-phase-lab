"use client";
import { useCallback, useRef, useState } from "react";
import type { Bar } from "@/lib/research/market-quote";

export type StoredSeries = { bars: Bar[]; before: Bar[]; /** the read failed: shown as an error, read again when the key comes back */ failed?: boolean };

/** Every chart series received while the page is open, by key ("MSFT:15m"; the part before the last ":" is the symbol). Owner, Nov 15:
 * - a period switch keeps the chart on the screen until the new series arrives (`shown` is then the last series shown for the same symbol, and `busy` is true
 *   so the chart shows a small spinner at its top right, never an empty or dimmed chart);
 * - a period read once is shown at once when it is picked again (`fresh(key)` says no read is needed).
 * `shownKey` is the key of what is shown, so the chart draws it with that period's rules until the new one comes. */
/** `initial`: a series drawn into the first HTML (a stock page's default period, speed Nov 26); it counts as read. */
export function useChartStore(key: string, initial: Record<string, StoredSeries> | null = null) {
  const [store, setStore] = useState<Record<string, StoredSeries>>(() => initial ?? {});
  const [lastKey, setLastKey] = useState<string | null>(null);
  const latest = useRef(store);
  // (latest starts as the initial store above, so fresh(key) is true for a series drawn by the server)
  const own = store[key];
  // Remember what was last on the screen (adjusting state while rendering: React re-renders at once, no effect needed).
  if (own && lastKey !== key) setLastKey(key);
  const group = (k: string) => k.slice(0, k.lastIndexOf(":"));
  const fallback = !own && lastKey && group(lastKey) === group(key) && !store[lastKey]?.failed ? store[lastKey] : undefined;
  const put = useCallback((k: string, series: StoredSeries) => { latest.current = { ...latest.current, [k]: series }; setStore(latest.current); }, []);
  const drop = useCallback((k: string) => { const next = { ...latest.current }; delete next[k]; latest.current = next; setStore(next); }, []);
  /** Already read and good: no new read is needed to show it. Read from effects and callbacks only. */
  const fresh = useCallback((k: string) => { const series = latest.current[k]; return !!series && !series.failed; }, []);
  return { shown: own ?? fallback ?? null, shownKey: own ? key : fallback ? lastKey! : null, busy: !own, put, drop, fresh };
}
