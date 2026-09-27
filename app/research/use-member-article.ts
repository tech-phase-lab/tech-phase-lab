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
    async function load() {
      if (stopped) return;
      controller?.abort(); clearTimeout(timer);
      controller = new AbortController();
      const current = controller;
      setResult({ id, status: "loading" });
      try {
        const response = await fetch(`/api/research/articles/${encodeURIComponent(id!)}`, { cache: "no-store", signal: AbortSignal.any([current.signal, AbortSignal.timeout(15_000)]) });
        if (current.signal.aborted) return;
        if (!response.ok) { setResult({ id, status: response.status === 401 ? "sign-in" : response.status === 403 ? "pro-required" : "error" }); return; }
        const data = await response.json();
        if (current.signal.aborted) return;
        if (data.event?.id !== id || !Number.isFinite(data.validUntil) || data.validUntil <= Date.now()) throw new Error("expired");
        setResult({ id, event: data.event, status: "ready" });
        // Expiry clears the received body; no continuous polling while reading.
        timer = setTimeout(() => { setResult({ id, status: "pro-required" }); }, Math.min(data.validUntil - Date.now(), 2_147_483_647));
      } catch { if (!current.signal.aborted) setResult({ id, status: "error" }); }
    }
    void load();
    window.addEventListener("focus", load);
    window.addEventListener("tech-phase:membership-changed", load);
    return () => { stopped = true; controller?.abort(); clearTimeout(timer); window.removeEventListener("focus", load); window.removeEventListener("tech-phase:membership-changed", load); };
  }, [id, enabled]);
  return enabled && result.id === id ? result : { status: "idle" };
}
