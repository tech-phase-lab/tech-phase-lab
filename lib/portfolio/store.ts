import type { Holding } from "./calc.ts";
import { OTHER } from "./brokers.ts";

/** The holdings live only in this browser (never sent to our server). This file is the one place that reads and writes them. */
export const STORE_KEY = "tech-phase:portfolio:v1";
export const HIDE_KEY = "tech-phase:portfolio:hide-amounts";
const listeners = new Set<() => void>();
export const subscribeStore = (notify: () => void) => { listeners.add(notify); return () => { listeners.delete(notify); }; };
const emit = () => listeners.forEach(listener => listener());

export function readRaw(storage: Pick<Storage, "getItem"> | null = typeof localStorage === "undefined" ? null : localStorage): string {
  try { return storage?.getItem(STORE_KEY) ?? ""; } catch { return ""; }
}

/** Anything unreadable or out of range is dropped, so a damaged value can never break the screen. */
export function parseStored(raw: string): Holding[] {
  try {
    const value = JSON.parse(raw);
    // Version 1 had one lot per ticker and no broker: it is read as the "その他" broker. Version 2 carries the broker on every lot.
    if (!value || (value.version !== 1 && value.version !== 2) || !Array.isArray(value.holdings)) return [];
    const out: Holding[] = [];
    for (const item of value.holdings.slice(0, 400)) {
      if (typeof item?.ticker !== "string" || !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(item.ticker)) continue;
      if (!(item.shares > 0) || !(item.avgCostUsd > 0) || !Number.isFinite(item.shares) || !Number.isFinite(item.avgCostUsd)) continue;
      out.push({ ticker: item.ticker, ...(typeof item.name === "string" ? { name: item.name.slice(0, 40) } : {}), shares: item.shares, avgCostUsd: item.avgCostUsd,
        ...(item.avgCostFx > 50 && item.avgCostFx < 400 ? { avgCostFx: item.avgCostFx } : {}),
        source: value.version === 2 && typeof item.source === "string" && item.source.trim() ? item.source.trim().slice(0, 20) : OTHER });
    }
    return out;
  } catch { return []; }
}

export function serialize(holdings: readonly Holding[]): string { return JSON.stringify({ version: 2, savedAt: new Date().toISOString(), holdings }); }

export function writeHoldings(holdings: readonly Holding[]) {
  try { if (holdings.length) localStorage.setItem(STORE_KEY, serialize(holdings)); else localStorage.removeItem(STORE_KEY); } catch { /* storage may be blocked */ }
  emit();
}

export function readHide(): boolean { try { return localStorage.getItem(HIDE_KEY) === "1"; } catch { return false; } }
export function writeHide(hide: boolean) { try { localStorage.setItem(HIDE_KEY, hide ? "1" : "0"); } catch { /* optional */ } emit(); }
