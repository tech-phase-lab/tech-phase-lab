"use client";
import { useEffect, useState } from "react";

const SEEN_KEY = "tech-phase:alerts-seen:v1";
const POLL_MS = 180_000;

function readSeen(): number | null {
  try { const value = Number(localStorage.getItem(SEEN_KEY)); return Number.isFinite(value) && value > 0 ? value : null; }
  catch { return null; }
}
function writeSeen(value: number) {
  try { localStorage.setItem(SEEN_KEY, String(value)); } catch { /* Unread falls back to this session. */ }
}

/** Newest publication time in the public news payload (ms), or 0. */
export function latestAlertTime(payload: unknown): number {
  if (!payload || typeof payload !== "object") return 0;
  const feed = payload as Record<string, unknown>;
  let latest = 0;
  for (const key of ["officialUpdates", "marketUpdates", "resultBriefs", "items"]) {
    const list = feed[key];
    if (!Array.isArray(list)) continue;
    for (const item of list.slice(0, 200)) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const at = Date.parse(String(row.publishedAt ?? row.observedAt ?? ""));
      if (Number.isFinite(at) && at <= Date.now() + 60_000 && at > latest) latest = at;
    }
  }
  return latest;
}

/** Red dot on 速報: is there an article newer than the reader's last visit? */
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
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch("/api/research/news", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
        if (!response.ok || !active) return;
        const latest = latestAlertTime(await response.json());
        if (!active) return;
        if (onAlertsPage) { writeSeen(Math.max(Date.now(), latest)); setUnread(false); return; }
        const seen = readSeen();
        // First visit: start from now instead of flagging the whole archive.
        if (seen === null) { writeSeen(Date.now()); setUnread(false); return; }
        setUnread(latest > seen);
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
