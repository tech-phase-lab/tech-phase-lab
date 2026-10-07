"use client";
import { useMemo, useState, useSyncExternalStore } from "react";
import { favoriteStocksKey } from "@/lib/research/favorites";
import { favoriteListsKey, parseFavoriteLists, type FavoriteLists } from "@/lib/research/favorite-lists";
const eventName = "tech-phase:favorite-lists";
function snapshot() {
  try { return JSON.stringify([localStorage.getItem(favoriteListsKey), localStorage.getItem(favoriteStocksKey)]); }
  catch { return "[null,null]"; }
}
function subscribe(notify: () => void) {
  const storage = (event: StorageEvent) => { if (!event.key || [favoriteListsKey, favoriteStocksKey].includes(event.key)) notify(); };
  window.addEventListener("storage", storage);
  window.addEventListener(eventName, notify);
  window.addEventListener("tech-phase:favorite-stocks", notify);
  return () => { window.removeEventListener("storage", storage); window.removeEventListener(eventName, notify); window.removeEventListener("tech-phase:favorite-stocks", notify); };
}
export function useFavoriteLists() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "[null,null]");
  const state = useMemo(() => { const [lists, legacy] = JSON.parse(raw); return parseFavoriteLists(lists, legacy); }, [raw]);
  const [error, setError] = useState(false);
  function update(change: (current: FavoriteLists) => FavoriteLists) {
    try {
      const [rawLists, legacy] = JSON.parse(snapshot());
      const next = change(parseFavoriteLists(rawLists, legacy));
      const nextRaw = JSON.stringify(next);
      // Write the custom lists first; retain the previous snapshot if the legacy
      // key fails so existing favorites are not silently lost on quota errors.
      localStorage.setItem(favoriteListsKey, nextRaw);
      try { localStorage.setItem(favoriteStocksKey, JSON.stringify(next.lists[0].tickers)); }
      catch (error) { if (rawLists === null) localStorage.removeItem(favoriteListsKey); else localStorage.setItem(favoriteListsKey, rawLists); throw error; }
      window.dispatchEvent(new Event(eventName));
      window.dispatchEvent(new Event("tech-phase:favorite-stocks"));
      setError(false); return true;
    } catch { setError(true); return false; }
  }
  return { ...state, update, error };
}
