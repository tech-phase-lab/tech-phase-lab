"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { favoriteStocksKey } from "@/lib/research/favorites";
import { favoriteListsKey, parseFavoriteLists, type FavoriteLists } from "@/lib/research/favorite-lists";
import { createFavoriteSync, favoriteDisplayDocument, type CloudFavorites, type FavoriteSyncStatus } from "@/lib/research/favorite-sync";
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
function useLocalFavoriteLists() {
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

export function useFavoriteLists() {
  const local = useLocalFavoriteLists();
  const [cloud, setCloud] = useState<CloudFavorites | null>(null);
  const [status, setStatus] = useState<FavoriteSyncStatus>("loading");
  const sync = useRef<ReturnType<typeof createFavoriteSync> | null>(null);
  useEffect(() => {
    const controller = createFavoriteSync(init => fetch("/api/research/favorites", {
      method: init ? "POST" : "GET", cache: "no-store", signal: AbortSignal.timeout(12000),
      ...(init ? { headers: { "Content-Type": "application/json" }, body: init.body } : {}),
    }), (next, state) => { setCloud(next); setStatus(state); });
    sync.current = controller;
    void controller.refresh();
    const visible = () => { if (document.visibilityState === "visible") void controller.refresh(); };
    const online = () => { void controller.retry(); };
    const timer = setInterval(visible, 30000);
    const protect = (event: BeforeUnloadEvent) => { if (controller.hasPending()) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", protect);
    window.addEventListener("focus", visible);
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visible);
    return () => {
      controller.dispose(); sync.current = null; clearInterval(timer);
      window.removeEventListener("beforeunload", protect); window.removeEventListener("focus", visible);
      window.removeEventListener("online", online); document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  function update(change: (state: FavoriteLists) => FavoriteLists) {
    return status === "guest" ? local.update(change) : sync.current?.update(change) ?? false;
  }
  const displayed = favoriteDisplayDocument(cloud, status, local);
  return { ...(displayed ?? { lists: [{ id: "default", name: "", tickers: [] }], names: {}, alerts: [] }), ready: displayed !== null, update, error: status === "guest" && local.error, status,
    retry: () => { void sync.current?.retry(); },
    canImport: !!cloud && cloud.revision === 0 && local.lists.some(item => item.tickers.length),
    importLocal: () => update(() => ({ lists: local.lists, names: local.names, alerts: local.alerts })),
    editable: status === "guest" || !!cloud && status !== "conflict" };
}
