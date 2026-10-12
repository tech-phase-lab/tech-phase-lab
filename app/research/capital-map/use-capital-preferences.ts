"use client";
import { useCallback, useEffect, useSyncExternalStore } from "react";

// Keep NEW visible while navigating this page; a reload starts a fresh visit.
const visitUpdates = new Map<string, boolean>();
const subscribe = () => () => {};
const serverSnapshot = () => false;

export function useCapitalUpdate(id: string | undefined, version: string | undefined, scope: "sample" | "reports") {
  const storageKey = `tech-phase:capital-map:${scope}:last-opened:${id ?? ""}`;
  const visitKey = `${storageKey}:${version ?? ""}`;
  const snapshot = useCallback(() => {
    if (!id || !version) return false;
    if (!visitUpdates.has(visitKey)) {
      let previous: string | null = null;
      try { previous = localStorage.getItem(storageKey); } catch { /* Storage unavailable. */ }
      visitUpdates.set(visitKey, previous !== null && previous !== version);
    }
    return visitUpdates.get(visitKey)!;
  }, [id, version, storageKey, visitKey]);
  const updated = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  useEffect(() => {
    if (!id || !version) return;
    snapshot();
    try { localStorage.setItem(storageKey, version); } catch { /* NEW is optional. */ }
  }, [id, version, storageKey, snapshot]);
  return updated;
}
