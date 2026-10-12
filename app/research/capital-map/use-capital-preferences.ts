"use client";
import { useSyncExternalStore } from "react";
import { parseCapitalPreferences } from "@/lib/research/capital-map";

const storageKey = "tech-phase:capital-map:sample-preferences:v1";
const eventName = "tech-phase:capital-map:sample-preferences";
let sessionPreferences: string | undefined;
function snapshot() {
  if (sessionPreferences !== undefined) return sessionPreferences;
  try { return localStorage.getItem(storageKey) || "{}"; }
  catch { return "{}"; }
}
function subscribe(notify: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey || event.key === null) { sessionPreferences = undefined; notify(); }
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(eventName, notify);
  return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(eventName, notify); };
}
function write(saved: string[], seen: Record<string, string>) {
  const raw = JSON.stringify({ saved, seen });
  sessionPreferences = raw;
  window.dispatchEvent(new Event(eventName));
  try { localStorage.setItem(storageKey, raw); return true; }
  catch { return false; }
}
export function useCapitalPreferences(ids: readonly string[]) {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "");
  return { ...parseCapitalPreferences(raw, ids), ready: raw !== "", write };
}
