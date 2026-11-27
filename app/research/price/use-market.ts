"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { MarketFacts } from "@/lib/research/market-quote";
import type { FavoriteQuote } from "@/lib/research/favorite-lists";
import { keepHistory } from "@/lib/research/quote-history";

export type CardQuote = FavoriteQuote & {
  name?: string; exchange?: string; open?: number | null; high?: number | null; low?: number | null; previousClose?: number | null; volume?: number | null;
  week52Low?: number | null; week52High?: number | null;
};
type State<T> = { data: T | null; failed: boolean; loaded: boolean; /** when the last good answer arrived (ms) */ at?: number | null };

/** Reads a JSON endpoint now and again every `every` ms while the tab is visible. The server caches for about a minute.
 * `keep`: when the address changes (a stock added to the watchlist), the last answer stays on the screen until the new one arrives, instead of
 * every row going blank for a moment (owner, Nov 25); only what the old answer did not have (the added stock) waits. */
export function usePolled<T>(url: string | null, pick: (body: Record<string, unknown>) => T | null, every: number, keep = false, merge?: (old: T | null, next: T) => T,
  /** Asks again after `ms` instead of `every` when the answer was not usable or `when` says it is incomplete. */
  retry?: { ms: number; when: (body: Record<string, unknown>) => boolean },
  /** An answer drawn into the first HTML (a stock page, speed Nov 26): shown at once; the first read still runs and replaces it. */
  initial?: { body: Record<string, unknown>; at: number } | null): State<T> {
  const [state, setState] = useState<State<T> & { url: string | null }>(() => {
    const data = initial ? pick(initial.body) : null;
    return data ? { data, failed: false, loaded: true, at: initial!.at, url } : { data: null, failed: false, loaded: false, url };
  });
  useEffect(() => {
    if (!url) return;
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController | undefined;
    const run = async () => {
      controller = new AbortController();
      let wait = every;
      try {
        const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
        const body = await response.json() as Record<string, unknown>;
        if (stopped) return;
        const picked = response.ok && body.ok === true ? pick(body) : null;
        if (retry && (picked === null || retry.when(body))) wait = retry.ms;
        const at = Date.now();
        setState(old => {
          const data = picked && merge ? merge(old.url === url || keep ? old.data : null, picked) : picked;
          return { url, data: data ?? (old.url === url || keep ? old.data : null), failed: data === null, loaded: true, at: data ? at : old.url === url ? old.at : null };
        });
      } catch { if (retry) wait = retry.ms; if (!stopped) setState(old => ({ url, data: old.url === url || keep ? old.data : null, failed: true, loaded: true })); }
      if (!stopped) timer = setTimeout(() => { if (document.visibilityState === "visible") void run(); else timer = setTimeout(run, every); }, wait);
    };
    void run();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  // `pick` is a module-level function at every call site.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, every, keep]);
  return state.url === url ? state : { data: keep ? state.data : null, failed: false, loaded: false };
}
const pickQuotes = (body: Record<string, unknown>) => body.quotes as Record<string, CardQuote>;

/** An answer whose statistics are missing (`complete: false`) keeps the last facts this page had and asks again in a minute, not in six hours. */
const pickFacts = (body: Record<string, unknown>) => {
  const facts = body.facts as MarketFacts | undefined;
  return facts && (body.complete !== false || facts.nextEarnings || facts.nextEarningsKnown) ? facts : null;
};
const factsRetry = { ms: 60_000, when: (body: Record<string, unknown>) => body.complete === false };
/** `fast` (the watchlist and a stock's page): asked every 15 seconds; the server reads the provider again only while the plan's minute leaves room. */
export const useQuotes = (tickers: string[], history = false, fast = false, keep = false, initial: { quotes: Record<string, unknown>; at: number } | null = null) => usePolled<Record<string, CardQuote>>(
  tickers.length ? `/api/research/market/quotes?tickers=${encodeURIComponent(tickers.join(","))}${history ? "&history=1" : ""}${fast ? "&fast=1" : ""}` : null, pickQuotes, fast ? 15_000 : 60_000, keep, history ? keepHistory : undefined,
  undefined, initial && { body: { ok: true, quotes: initial.quotes }, at: initial.at });
export const useFacts = (ticker: string) => usePolled<MarketFacts>(`/api/research/market/facts?ticker=${encodeURIComponent(ticker)}`, pickFacts, 6 * 3600_000, false, undefined, factsRetry);

const key = "tech-phase:quote-numbers-hidden:v1", event = "tech-phase:quote-numbers-hidden";
const subscribe = (notify: () => void) => { window.addEventListener("storage", notify); window.addEventListener(event, notify); return () => { window.removeEventListener("storage", notify); window.removeEventListener(event, notify); }; };
let session: boolean | undefined;
const snapshot = () => { if (session !== undefined) return session; try { return localStorage.getItem(key) === "1"; } catch { return false; } };
/** The eye button: numbers hidden or shown, kept in this browser. */
export function useNumbersHidden() {
  const hidden = useSyncExternalStore(subscribe, snapshot, () => false);
  const set = (value: boolean) => { session = value; try { localStorage.setItem(key, value ? "1" : "0"); } catch { /* kept for this visit */ } window.dispatchEvent(new Event(event)); };
  return [hidden, set] as const;
}

/** Company names as the cards show them: "Micron Technology Inc" → "Micron Technology", "Alphabet / Google" → "Alphabet", never cut with an ellipsis. */
export { shortCompanyName as shortName } from "@/lib/research/company-short-name";
