"use client";

import { useEffect, useState } from "react";
import { snapshotIssues, type IntakeSnapshot } from "./intake";

export type MonitorState = {
  ready: boolean;
  startedAt: string;
  lastCycleAt: string | null;
  lastCycleAgeSeconds?: number | null;
  lastCycleDurationMs: number | null;
  lastCycleCompanies: number;
  lastChangeAt: string | null;
  cycles: number;
  newSources: number;
  generation?: {
    requested: boolean; configured: boolean; enabled: boolean; dailyLimit: number; maxAttempts: number;
    tokenLimit: number;
    waitingBody?: number; queued?: number; running?: number; retry?: number; succeeded?: number; failed?: number;
    attemptsLast24Hours?: number; limitReached?: boolean; lastAttemptAt?: string | null;
    lastSuccessAt?: string | null; lastErrorCode?: string | null;
    budgetTokensLast24Hours?: number; measuredTokensLast24Hours?: number;
    tokenLimitReached?: boolean; tokenBudgetBlocked?: number;
  };
  backup?: {
    enabled: boolean; intervalSeconds: number; graceSeconds?: number; retention: number;
    lastAttemptAt: string | null; lastSuccessAt: string | null;
    healthy: boolean | null; backupCount: number; lastError: string | null;
    lastSuccessAgeSeconds?: number | null; overdueAfterSeconds?: number;
    overdue?: boolean; status?: "waiting" | "ok" | "failed" | "overdue";
  };
  health?: {
    status: "starting" | "ready" | "degraded";
    issues: Array<"monitor-stale" | "backup-failed" | "backup-overdue">;
    monitorStaleAfterSeconds: number;
  };
  companies: Record<string, {
    basePollSeconds?: number; nextPollSeconds?: number; requestDurationMs?: number;
    status: string; route: string; candidates: number; checkedAt: string; error: string | null;
  }>;
};

type LiveState = {
  snapshot: IntakeSnapshot;
  mode: "automatic" | "snapshot";
  monitor: MonitorState | null;
  error: "not-configured" | "monitor-unavailable" | null;
};

export function useLiveIntake(initialSnapshot: IntakeSnapshot, intervalMs = 3_000) {
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
