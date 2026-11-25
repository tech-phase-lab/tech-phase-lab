"use client";
import { useMemo, useSyncExternalStore } from "react";
import type { FavoriteLists, FavoriteQuote } from "@/lib/research/favorite-lists";
import { emptyWatchlistSnapshot, parseWatchlistSnapshot, serializeWatchlistSnapshot, signInHint, watchlistSnapshotKey, withLists, withQuotes, type WatchlistSnapshot } from "@/lib/research/watchlist-snapshot";

// Read once per page load and kept in step with every save, so a render never re-reads storage. The server and the hydrating render see
// nothing (null) and the browser's first render right after shows the copy, before anything is painted.
let raw: string | null | undefined;
const read = () => {
  if (raw === undefined) { try { raw = localStorage.getItem(watchlistSnapshotKey); } catch { raw = null; } }
  return raw;
};
const subscribe = () => () => {};
const write = (change: (snapshot: WatchlistSnapshot) => WatchlistSnapshot) => {
  const next = serializeWatchlistSnapshot(change(parseWatchlistSnapshot(read() ?? null)));
  if (next === raw) return;
  raw = next;
  try { localStorage.setItem(watchlistSnapshotKey, next); } catch { /* full or blocked storage: the page simply waits for the server, as before */ }
};
export const saveWatchlistQuotes = (quotes: Record<string, FavoriteQuote>) => { if (Object.keys(quotes).length) write(snapshot => withQuotes(snapshot, quotes)); };
export const saveWatchlistLists = (owner: string | null, lists: FavoriteLists | null) => write(snapshot => withLists(snapshot, owner, lists));

/** The watchlist's last screen on this device (lib/research/watchlist-snapshot.ts). */
export function useWatchlistSnapshot(): WatchlistSnapshot {
  const stored = useSyncExternalStore(subscribe, read, () => null);
  return useMemo(() => stored === null ? emptyWatchlistSnapshot : parseWatchlistSnapshot(stored), [stored]);
}
const cookie = () => { try { return document.cookie; } catch { return ""; } };
/** The sign-in this browser holds before the identity SDK has loaded ("out", a sign-in key, or null when unknown). */
export function useSignInHint() {
  const value = useSyncExternalStore(subscribe, cookie, () => null);
  return value === null ? null : signInHint(value);
}
