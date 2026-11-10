"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { MarketFacts } from "@/lib/research/market-quote";
import type { FavoriteQuote } from "@/lib/research/favorite-lists";

export type CardQuote = FavoriteQuote & {
  name?: string; exchange?: string; open?: number | null; high?: number | null; low?: number | null; previousClose?: number | null; volume?: number | null;
  week52Low?: number | null; week52High?: number | null;
};
type State<T> = { data: T | null; failed: boolean; loaded: boolean };

/** Reads a JSON endpoint now and again every `every` ms while the tab is visible. The server caches for about a minute. */
function usePolled<T>(url: string | null, pick: (body: Record<string, unknown>) => T | null, every: number): State<T> {
  const [state, setState] = useState<State<T> & { url: string | null }>({ data: null, failed: false, loaded: false, url });
  useEffect(() => {
    if (!url) return;
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController | undefined;
    const run = async () => {
      controller = new AbortController();
      try {
        const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
        const body = await response.json() as Record<string, unknown>;
        if (stopped) return;
        const data = response.ok && body.ok === true ? pick(body) : null;
        setState(old => ({ url, data: data ?? (old.url === url ? old.data : null), failed: data === null, loaded: true }));
      } catch { if (!stopped) setState(old => ({ url, data: old.url === url ? old.data : null, failed: true, loaded: true })); }
      if (!stopped) timer = setTimeout(() => { if (document.visibilityState === "visible") void run(); else timer = setTimeout(run, every); }, every);
    };
    void run();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  // `pick` is a module-level function at every call site.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, every]);
  return state.url === url ? state : { data: null, failed: false, loaded: false };
}
const pickQuotes = (body: Record<string, unknown>) => body.quotes as Record<string, CardQuote>;
const pickFacts = (body: Record<string, unknown>) => body.facts as MarketFacts;
export const useQuotes = (tickers: string[], history = false) => usePolled<Record<string, CardQuote>>(
  tickers.length ? `/api/research/market/quotes?tickers=${encodeURIComponent(tickers.join(","))}${history ? "&history=1" : ""}` : null, pickQuotes, 60_000);
export const useFacts = (ticker: string) => usePolled<MarketFacts>(`/api/research/market/facts?ticker=${encodeURIComponent(ticker)}`, pickFacts, 6 * 3600_000);

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

/** Company names as the cards show them: "Micron Technology Inc" → "Micron Technology", never cut with an ellipsis. */
export const shortName = (name: string) => name.replace(/[,.]?\s+(Inc|Incorporated|Corp|Corporation|Co|Company|Ltd|Limited|PLC|Plc|N\.V|S\.A|Holdings?)\.?(\s+Class [A-C])?$/i, "").replace(/\s+/g, " ").trim() || name;
export const jstClock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false });
