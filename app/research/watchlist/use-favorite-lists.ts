"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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

const empty: FavoriteLists = { lists: [{ id: "default", name: "", tickers: [] }], names: {}, alerts: [] };
type Cloud = { account: string; revision: number; document: FavoriteLists };
export function useFavoriteLists() {
  const local = useLocalFavoriteLists();
  const [cloud, setCloud] = useState<Cloud | null>(null);
  const current = useRef<Cloud | null>(null);
  const pending = useRef(false), writing = useRef(false), alive = useRef(true);
  const [status, setStatus] = useState<"loading" | "guest" | "synced" | "saving" | "error" | "conflict">("loading");
  const refresh = useCallback(async () => {
    if (pending.current || writing.current) return;
    try {
      const response = await fetch("/api/research/favorites", { cache: "no-store" });
      const data = await response.json();
      if (!alive.current || pending.current) return;
      if (response.status === 401) { current.current = null; setCloud(null); setStatus("guest"); return; }
      if (!response.ok || !data.ok) throw new Error();
      if (current.current && current.current.account === data.account && current.current.revision > data.revision) return;
      const next = { account: data.account, revision: data.revision, document: data.document ?? empty };
      current.current = next; setCloud(next); setStatus("synced");
    } catch { if (alive.current) setStatus("error"); }
  }, []);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = setInterval(visible, 30000);
    const protect = (event: BeforeUnloadEvent) => { if (pending.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", protect);
    window.addEventListener("focus", visible);
    return () => { alive.current = false; clearInterval(timer); window.removeEventListener("beforeunload", protect); window.removeEventListener("focus", visible); };
  }, [refresh]);
  async function flush() {
    if (writing.current || !current.current || !pending.current) return;
    writing.current = true;
    setStatus("saving");
    try {
      while (pending.current && current.current) {
        const sent: Cloud = current.current;
        const response = await fetch("/api/research/favorites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sent) });
        const data = await response.json();
        if (!alive.current) return;
        if (response.status === 409) { setStatus("conflict"); return; }
        if (!response.ok || !data.ok || data.account !== sent.account) throw new Error();
        pending.current = current.current.document !== sent.document;
        current.current = { ...current.current, revision: data.revision };
        setCloud(current.current);
      }
      setStatus("synced");
    } catch { if (alive.current) setStatus("error"); }
    finally { writing.current = false; }
  }
  function update(change: (state: FavoriteLists) => FavoriteLists) {
    if (status === "guest") return local.update(change);
    if (!current.current || status === "conflict") return false;
    const next = { ...current.current, document: change(current.current.document) };
    current.current = next; setCloud(next); pending.current = true;
    void flush(); return true;
  }
  return { ...(cloud?.document ?? local), update, error: local.error, status,
    retry: () => pending.current ? void flush() : void refresh(),
    canImport: !!cloud && cloud.revision === 0 && local.lists.some(item => item.tickers.length),
    importLocal: () => update(() => ({ lists: local.lists, names: local.names, alerts: local.alerts })),
    editable: status === "guest" || !!cloud && status !== "conflict" };
}
