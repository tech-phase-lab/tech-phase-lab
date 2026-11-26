"use client";
import { useEffect, useState } from "react";
import type { AlertItem } from "@/lib/research/alert-items";

const SEEN_KEY = "tech-phase:alerts-seen:v1";
const REASON_KEY = "tech-phase:alerts-unread-reason:v1";
const POLL_MS = 180_000;

export function readAlertsSeen(): number | null {
  try { const value = Number(localStorage.getItem(SEEN_KEY)); return Number.isFinite(value) && value > 0 ? value : null; }
  catch { return null; }
}
const BEFORE_KEY = "tech-phase:alerts-seen-before-visit:v1";
/** When the owner last left 速報 before this visit. Opening the page rewrites
 * the record to "now", so the page asks here instead of reading the record. */
export function readVisitStart(): number | null {
  const seen = readAlertsSeen();
  if (seen !== null && Date.now() - seen > 5_000) return seen;
  try { const before = Number(sessionStorage.getItem(BEFORE_KEY)); if (Number.isFinite(before) && before > 0) return before; } catch { /* Falls back to the record. */ }
  return seen;
}
/** One read of the listed alerts shared by every menu that shows the dot (phone menu and desktop sidebar are both mounted) and by
 * the next page within FRESH_MS: each page view had read /api/research/news and /api/research/company-wire two or three times, one
 * after the other, competing with the page's own data on a phone line (measured Nov 26). The two feeds are read side by side, and
 * the rules that pick the listed rows are loaded only when the dot is checked, so they stay out of every page's first script. */
const FRESH_MS = 60_000;
let shared: { at: number; items: Promise<AlertItem[]> } | null = null;
function forgetShared() { shared = null; }
if (typeof window !== "undefined") window.addEventListener("tech-phase:membership-changed", forgetShared);
function listedAlerts(signal: AbortSignal): Promise<AlertItem[]> {
  if (shared && Date.now() - shared.at < FRESH_MS) return shared.items;
  const timeout = AbortSignal.timeout(10_000);
  const news = fetch("/api/research/news", { cache: "no-store", signal: timeout }).then(response => response.ok ? response.json() : Promise.reject(new Error("news")));
  // Wire headlines are a separate lane: if they cannot be read, the rest still counts.
  const wire = fetch("/api/research/company-wire", { cache: "no-store", signal: timeout }).then(reply => reply.ok ? reply.json() : null).catch(() => null);
  const items = Promise.all([news, wire, import("@/lib/research/alert-items"), import("@/lib/research/company-wire")])
    .then(([feed, rawWire, { alertItems }, { parseCompanyWire }]) => alertItems(feed, rawWire ? parseCompanyWire(rawWire).items : {}));
  const entry = { at: Date.now(), items };
  shared = entry;
  items.catch(() => { if (shared === entry) shared = null; });
  return new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    items.then(resolve, reject);
  });
}
/** The dot waits until the page's own data has had the line first (idle, or at most START_DELAY_MS). */
const START_DELAY_MS = 2_500;
function afterPageData(run: () => void): () => void {
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void });
  if (idle.requestIdleCallback) { const id = idle.requestIdleCallback(run, { timeout: START_DELAY_MS }); return () => idle.cancelIdleCallback?.(id); }
  const id = window.setTimeout(run, START_DELAY_MS); return () => window.clearTimeout(id);
}
function writeSeen(value: number) {
  try { localStorage.setItem(SEEN_KEY, String(value)); } catch { /* Unread falls back to this session. */ }
}

/** Red dot on 速報 (owner rules, Oct 8):
 * 1. A device with no record stores "now" and shows no dot.
 * 2. The dot means a listed alert was published after the last visit.
 * 3. Only rows the 速報 page lists count (see alertItems / flash-rows).
 * 4. Opening 速報 updates the record and clears the dot.
 * 5. The articles that raised the dot are logged and kept for inspection
 *    (localStorage "tech-phase:alerts-unread-reason:v1"). */
export function useAlertsUnread(onAlertsPage: boolean) {
  const [unread, setUnread] = useState(false);
  useEffect(() => {
    if (onAlertsPage) {
      const before = readAlertsSeen();
      try { if (before !== null && Date.now() - before > 5_000) sessionStorage.setItem(BEFORE_KEY, String(before)); } catch { /* Optional. */ }
      writeSeen(Date.now());
    }
  }, [onAlertsPage]);
  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    async function check() {
      if (document.visibilityState !== "visible") return;
      const seen = readAlertsSeen();
      if (seen === null || onAlertsPage) { writeSeen(Date.now()); setUnread(false); return; }
      controller?.abort();
      controller = new AbortController();
      try {
        const items = await listedAlerts(controller.signal);
        if (!active) return;
        const fresh = items.filter(item => item.at > seen);
        if (!active) return;
        setUnread(fresh.length > 0);
        try {
          if (fresh.length) {
            const reason = { seenAt: new Date(seen).toISOString(), checkedAt: new Date().toISOString(),
              items: fresh.slice(0, 5).map(item => ({ id: item.id, title: item.title, publishedAt: new Date(item.at).toISOString() })) };
            localStorage.setItem(REASON_KEY, JSON.stringify(reason));
            console.info("[速報] 新着あり", reason);
          } else localStorage.removeItem(REASON_KEY);
        } catch { /* Diagnostics are optional. */ }
      } catch { /* Keep the last known state; the next poll retries. */ }
    }
    const cancelStart = afterPageData(() => { void check(); });
    const timer = window.setInterval(check, POLL_MS);
    const visible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; cancelStart(); controller?.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [onAlertsPage]);
  return unread && !onAlertsPage;
}
