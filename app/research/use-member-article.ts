"use client";
import { useEffect, useState } from "react";
import type { ResearchEvent } from "@/lib/research/data";
export function useMemberArticle(id: string | undefined, enabled: boolean) {
  const [result, setResult] = useState<{ id?: string; event?: ResearchEvent; status: string }>({ status: "idle" });
  useEffect(() => {
    if (!id || !enabled) return;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let inFlight = false, validUntil = 0, lastStarted = 0;
    async function load(reset = false) {
      if (stopped || (!reset && (inFlight || Date.now() - lastStarted < 30_000))) return;
      inFlight = true; lastStarted = Date.now();
      controller?.abort();
      if (reset) { clearTimeout(timer); validUntil = 0; }
      controller = new AbortController();
      const current = controller;
      // Returning to the tab must not blank an article whose server lease is
      // still valid. The existing expiry timer keeps running during renewal.
      setResult(previous => !reset && previous.id === id && previous.event && validUntil > Date.now()
        ? previous : { id, status: "loading" });
      try {
        const response = await fetch(`/api/research/articles/${encodeURIComponent(id!)}`, { cache: "no-store", signal: AbortSignal.any([current.signal, AbortSignal.timeout(15_000)]) });
        if (current.signal.aborted) return;
        if (!response.ok) { validUntil = 0; clearTimeout(timer); setResult({ id, status: response.status === 401 ? "sign-in" : response.status === 403 ? "pro-required" : "error" }); return; }
        const data = await response.json();
        if (current.signal.aborted) return;
        if (data.event?.id !== id || !Number.isFinite(data.validUntil) || data.validUntil <= Date.now()) throw new Error("expired");
        clearTimeout(timer); validUntil = data.validUntil;
        setResult({ id, event: data.event, status: "ready" });
        // Expiry clears the received body; no continuous polling while reading.
        timer = setTimeout(() => { validUntil = 0; setResult({ id, status: "pro-required" }); }, Math.min(data.validUntil - Date.now(), 2_147_483_647));
      } catch { if (!current.signal.aborted && validUntil <= Date.now()) setResult({ id, status: "error" }); }
      finally { if (controller === current) inFlight = false; }
    }
    void load();
    const resume = () => { if (!document.hidden) void load(); };
    const changed = () => { void load(true); };
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("tech-phase:membership-changed", changed);
    return () => { stopped = true; controller?.abort(); clearTimeout(timer); window.removeEventListener("focus", resume); document.removeEventListener("visibilitychange", resume); window.removeEventListener("tech-phase:membership-changed", changed); };
  }, [id, enabled]);
  return enabled && result.id === id ? result : { status: "idle" };
}
