"use client";
import { useEffect, useState } from "react";
import { stocksTrading } from "@/lib/research/twelve-budget";
import { liveQuoteUrl, startLiveQuote } from "@/lib/research/live-quote";
import { startPolling } from "./polling";
import { useMinute } from "./use-minute";
import type { CardQuote } from "./use-market";

type First = { quotes: Record<string, unknown>; at: number } | null;
type State = { ticker: string; quote: CardQuote | null; at: number | null; loaded: boolean; failed: boolean };
const begin = (ticker: string, initial: First): State => {
  const quote = (initial?.quotes?.[ticker] as CardQuote | undefined) ?? null;
  return { ticker, quote, at: quote && initial ? initial.at : null, loaded: quote !== null, failed: false };
};

/** A stock page's quote: the server's first copy at once, then every 15 seconds while stocks trade (paused while the tab is hidden), once
 * outside those hours (lib/research/live-quote.ts). A failed read keeps the price on the screen. `at`: when the last good answer arrived. */
export function useLiveQuote(ticker: string, initial: First = null) {
  const [state, setState] = useState<State>(() => begin(ticker, initial));
  const now = useMinute();
  const ready = now !== null, trading = now !== null && stocksTrading(now);
  useEffect(() => {
    if (!ready) return;
    let stopped = false;
    const controller = new AbortController();
    const read = async () => {
      let quote: CardQuote | null = null;
      try {
        const response = await fetch(liveQuoteUrl(ticker), { cache: "no-store", signal: controller.signal });
        const body = await response.json() as { ok?: boolean; quotes?: Record<string, CardQuote> };
        quote = response.ok && body.ok === true ? body.quotes?.[ticker] ?? null : null;
      } catch { /* the price on the screen stays */ }
      if (stopped) return;
      const at = Date.now();
      setState(old => quote ? { ticker, quote, at, loaded: true, failed: false } : { ...(old.ticker === ticker ? old : begin(ticker, null)), loaded: true, failed: true });
    };
    const stop = startLiveQuote(trading, read, startPolling);
    return () => { stopped = true; controller.abort(); stop(); };
  }, [ticker, ready, trading]);
  const own = state.ticker === ticker ? state : begin(ticker, null);
  return { quote: own.quote, at: own.at, loaded: own.loaded, failed: own.failed };
}

type ManyState = { key: string; quotes: Record<string, CardQuote>; at: number | null; loaded: boolean; failed: boolean };
/** Several stocks' quotes in ONE request (the 監視22銘柄 list, owner Nov 27: its numbers move in real time), on the same cadence as
 * useLiveQuote: every 15 seconds while U.S. stocks trade, paused while the tab is hidden, once outside those hours. Only our quotes route
 * is read (the shared copy), never the provider. A failed read keeps the prices on the screen. `enabled` false (a fixed sample): no read. */
export function useLiveQuotes(tickers: readonly string[], enabled = true) {
  const key = tickers.join(",");
  const [state, setState] = useState<ManyState>({ key, quotes: {}, at: null, loaded: false, failed: false });
  const now = useMinute();
  const ready = enabled && key !== "" && now !== null, trading = now !== null && stocksTrading(now);
  useEffect(() => {
    if (!ready) return;
    let stopped = false;
    const controller = new AbortController();
    const read = async () => {
      let quotes: Record<string, CardQuote> | null = null;
      try {
        const response = await fetch(liveQuoteUrl(key.split(",")), { cache: "no-store", signal: controller.signal });
        const body = await response.json() as { ok?: boolean; quotes?: Record<string, CardQuote> };
        quotes = response.ok && body.ok === true && body.quotes ? body.quotes : null;
      } catch { /* the prices on the screen stay */ }
      if (stopped) return;
      const at = Date.now();
      setState(old => {
        const kept = old.key === key ? old.quotes : {};
        return quotes ? { key, quotes: { ...kept, ...quotes }, at, loaded: true, failed: false } : { key, quotes: kept, at: old.key === key ? old.at : null, loaded: true, failed: true };
      });
    };
    const stop = startLiveQuote(trading, read, startPolling);
    return () => { stopped = true; controller.abort(); stop(); };
  }, [key, ready, trading]);
  return state.key === key ? state : { key, quotes: {}, at: null, loaded: false, failed: false };
}
