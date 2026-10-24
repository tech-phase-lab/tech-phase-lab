"use client";

import { useSyncExternalStore } from "react";

const key = "tech-phase:watchlist-selection:v1";
const eventName = "tech-phase:watchlist-selection";
let sessionSelection: string | undefined;
const valid = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(value);

function snapshot() {
  if (sessionSelection) return sessionSelection;
  try {
    const saved = sessionStorage.getItem(key);
    return valid(saved) ? saved : "default";
  } catch { return "default"; }
}
function subscribe(notify: () => void) {
  window.addEventListener(eventName, notify);
  return () => window.removeEventListener(eventName, notify);
}

/** Remember only the visible list ID in this tab; stock data uses account sync. */
export function useWatchlistSelection() {
  const listId = useSyncExternalStore(subscribe, snapshot, () => "default");
  function setListId(value: string) {
    if (!valid(value)) return;
    sessionSelection = value;
    try { sessionStorage.setItem(key, value); } catch { /* Keep navigation usable when tab storage is blocked. */ }
    window.dispatchEvent(new Event(eventName));
  }
  return [listId, setListId] as const;
}
