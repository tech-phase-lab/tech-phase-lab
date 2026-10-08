"use client";
import { useEffect, useState } from "react";
import { alertItems } from "@/lib/research/alert-items";

const SEEN_KEY = "tech-phase:alerts-seen:v1";
const REASON_KEY = "tech-phase:alerts-unread-reason:v1";
const POLL_MS = 180_000;

function readSeen(): number | null {
  try { const value = Number(localStorage.getItem(SEEN_KEY)); return Number.isFinite(value) && value > 0 ? value : null; }
  catch { return null; }
}
function writeSeen(value: number) {
  try { localStorage.setItem(SEEN_KEY, String(value)); } catch { /* Unread falls back to this session. */ }
}

/** Red dot on 速報 (owner rules, Oct 8):
 * 1. A device with no record stores "now" and shows no dot.
 * 2. The dot means a listed alert was published after the last visit.
 * 3. Only stories the 速報 page lists count (see alertItems).
 * 4. Opening 速報 updates the record and clears the dot.
 * 5. The articles that raised the dot are logged and kept for inspection
 *    (localStorage "tech-phase:alerts-unread-reason:v1"). */
export function useAlertsUnread(onAlertsPage: boolean) {
  const [unread, setUnread] = useState(false);
  useEffect(() => {
    if (onAlertsPage) writeSeen(Date.now());
  }, [onAlertsPage]);
  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    async function check() {
      if (document.visibilityState !== "visible") return;
      const seen = readSeen();
      if (seen === null || onAlertsPage) { writeSeen(Date.now()); setUnread(false); return; }
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch("/api/research/news", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
        if (!response.ok || !active) return;
        const fresh = alertItems(await response.json()).filter(item => item.at > seen);
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
