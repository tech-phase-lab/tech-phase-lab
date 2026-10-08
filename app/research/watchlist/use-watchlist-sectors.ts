"use client";

import { useEffect, useRef, useState } from "react";
import { sectorFromProfile, type SicSector } from "@/lib/research/watchlist-sector";

// Resolve only the active list's missing classifications. One request at a time;
// the existing SEC profile endpoint provides server caching and issuer validation.
export function useWatchlistSectors(tickers: string[]) {
  const key = [...new Set(tickers)].sort().join(",");
  const [sectors, setSectors] = useState<Record<string, SicSector>>({});
  const checked = useRef(new Map<string, number>());
  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    async function refresh() {
      if (running || controller.signal.aborted || !key) return;
      running = true;
      try {
        for (const ticker of key.split(",")) {
          if (controller.signal.aborted) return;
          if ((checked.current.get(ticker) ?? 0) > Date.now()) continue;
          try {
            const response = await fetch(`/api/research/stocks?ticker=${encodeURIComponent(ticker)}`, {
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
            });
            if (!response.ok) throw new Error("sector-unavailable");
            const data: unknown = await response.json();
            if (controller.signal.aborted) return;
            const sector = sectorFromProfile(ticker, data);
            if (sector) setSectors(current => ({ ...current, [ticker]: sector }));
            // Retry successful but unclassified responses on later visits too.
            checked.current.set(ticker, Date.now() + (sector ? 3_600_000 : 60_000));
          } catch {
            if (controller.signal.aborted) return;
            checked.current.set(ticker, Date.now() + 30_000);
          }
        }
      } finally {
        running = false;
      }
    }
    const retry = () => { void refresh(); };
    const visible = () => { if (document.visibilityState === "visible") retry(); };
    void refresh();
    window.addEventListener("focus", retry);
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", visible);
    return () => {
      controller.abort();
      window.removeEventListener("focus", retry);
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [key]);
  return sectors;
}
