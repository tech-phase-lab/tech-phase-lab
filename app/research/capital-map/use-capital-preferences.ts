"use client";
import { useCallback, useSyncExternalStore } from "react";
import { parseCapitalPreferences } from "@/lib/research/capital-map";

const sessionPreferences = new Map<string, string>();
export function useCapitalPreferences(ids: readonly string[], scope: "sample" | "reports" = "sample") {
  const storageKey = `tech-phase:capital-map:${scope}-preferences:v1`;
  const eventName = `tech-phase:capital-map:${scope}-preferences`;
  const snapshot = useCallback(() => {
    if (sessionPreferences.has(storageKey)) return sessionPreferences.get(storageKey)!;
    try { return localStorage.getItem(storageKey) || "{}"; }
    catch { return "{}"; }
  }, [storageKey]);
  const subscribe = useCallback((notify: () => void) => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) { sessionPreferences.delete(storageKey); notify(); }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(eventName, notify);
    return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(eventName, notify); };
  }, [storageKey, eventName]);
  const raw = useSyncExternalStore(subscribe, snapshot, () => "");
  function write(saved: string[], seen: Record<string, string>) {
    const value = JSON.stringify({ saved, seen });
    sessionPreferences.set(storageKey, value);
    window.dispatchEvent(new Event(eventName));
    try { localStorage.setItem(storageKey, value); return true; }
    catch { return false; }
  }
  return { ...parseCapitalPreferences(raw, ids), ready: raw !== "", write };
}
