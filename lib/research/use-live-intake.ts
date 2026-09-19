"use client";

import { useEffect, useState } from "react";
import { snapshotIssues, type IntakeSnapshot } from "./intake";

export type MonitorState = {
  ready: boolean;
  startedAt: string;
  lastCycleAt: string | null;
  lastChangeAt: string | null;
  cycles: number;
  newSources: number;
};

type LiveState = {
  snapshot: IntakeSnapshot;
  mode: "automatic" | "snapshot";
  monitor: MonitorState | null;
  error: "not-configured" | "monitor-unavailable" | null;
};

export function useLiveIntake(initialSnapshot: IntakeSnapshot, intervalMs = 10_000) {
  const [state, setState] = useState<LiveState>({ snapshot: initialSnapshot, mode: "snapshot", monitor: null, error: null });

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const response = await fetch("/api/research/live", { cache: "no-store" });
        const payload = await response.json() as { mode?: "automatic" | "snapshot"; monitor?: MonitorState; error?: LiveState["error"]; snapshot?: IntakeSnapshot };
        if (!active || !payload.snapshot || snapshotIssues(payload.snapshot).length) return;
        setState({
          snapshot: payload.snapshot,
          mode: payload.mode === "automatic" ? "automatic" : "snapshot",
          monitor: payload.mode === "automatic" ? payload.monitor ?? null : null,
          error: payload.error ?? null,
        });
      } catch {
        if (active) setState((current) => ({ ...current, mode: "snapshot", monitor: null, error: "monitor-unavailable" }));
      }
    }
    const initial = window.setTimeout(() => { void refresh(); }, 0);
    const timer = window.setInterval(() => { void refresh(); }, intervalMs);
    return () => {
      active = false;
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [intervalMs]);

  return state;
}
