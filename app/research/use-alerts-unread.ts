"use client";
import { useEffect, useState } from "react";
import { alertItems } from "@/lib/research/alert-items";
import { parseCompanyWire } from "@/lib/research/company-wire";

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
        const response = await fetch("/api/research/news", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
        if (!response.ok || !active) return;
        const feed = await response.json();
        // Wire headlines are a separate lane: if they cannot be read, the rest still counts.
        const wire = await fetch("/api/research/company-wire", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) })
          .then(async reply => reply.ok ? parseCompanyWire(await reply.json()).items : {}).catch(() => ({}));
        if (!active) return;
        const fresh = alertItems(feed, wire).filter(item => item.at > seen);
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
    void check();
    const timer = window.setInterval(check, POLL_MS);
    const visible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; controller?.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [onAlertsPage]);
  return unread && !onAlertsPage;
}
