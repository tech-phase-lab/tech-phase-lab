"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { favoriteStocksKey, parseFavoriteStocks, toggleFavoriteStock } from "@/lib/research/favorites";

const eventName = "tech-phase:favorite-stocks";
function snapshot() { try { return localStorage.getItem(favoriteStocksKey) ?? "[]"; } catch { return "[]"; } }
function subscribe(notify: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === favoriteStocksKey || event.key === null) notify(); };
  window.addEventListener("storage", onStorage);
  window.addEventListener(eventName, notify);
  return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(eventName, notify); };
}

export function useStockFavorites() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "[]");
  const favorites = useMemo(() => parseFavoriteStocks(raw), [raw]);
  const [error, setError] = useState(false);
  function toggle(ticker: string) {
    try {
      const latest = parseFavoriteStocks(localStorage.getItem(favoriteStocksKey));
      localStorage.setItem(favoriteStocksKey, JSON.stringify(toggleFavoriteStock(latest, ticker)));
      window.dispatchEvent(new Event(eventName));
      setError(false);
    } catch { setError(true); }
  }
  return { favorites, toggle, error };
}
