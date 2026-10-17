"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { parseStockHistory, rememberStock, stockHistoryKey } from "@/lib/research/stock-history";

const changeEvent = "tech-phase:stock-history";
function snapshot() { try { return localStorage.getItem(stockHistoryKey) ?? "[]"; } catch { return "[]"; } }
function subscribe(notify: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === stockHistoryKey || event.key === null) notify(); };
  window.addEventListener("storage", onStorage);
  window.addEventListener(changeEvent, notify);
  return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(changeEvent, notify); };
}

export function useStockHistory() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "[]");
  const history = useMemo(() => parseStockHistory(raw), [raw]);
  const [error, setError] = useState(false);
  function remember(ticker: string) {
    try {
      localStorage.setItem(stockHistoryKey, JSON.stringify(rememberStock(parseStockHistory(localStorage.getItem(stockHistoryKey)), ticker)));
      window.dispatchEvent(new Event(changeEvent));
      setError(false);
    } catch { setError(true); }
  }
  function clear() {
    try { localStorage.removeItem(stockHistoryKey); window.dispatchEvent(new Event(changeEvent)); setError(false); }
    catch { setError(true); }
  }
  return { history, remember, clear, error };
}
