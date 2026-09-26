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
    nextRetryAt?: string | null; nextRetryWaitSeconds?: number | null;
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
    issues: Array<"monitor-stale" | "backup-failed" | "backup-overdue" | "incident-watch-failed" | "body-fetch-failed" | "body-fetch-stale" | "discovery-poll-stale" | "priority-source-pending" | "priority-source-degraded" | "priority-source-metrics-failed">;
    monitorStaleAfterSeconds: number;
  };
  incidentWatch?: {
    enabled: boolean; intervalSeconds: number; lastCheckAt: string | null;
    healthy: boolean | null; lastError: string | null;
  };
  notification?: {
    requested: boolean; configured: boolean; enabled: boolean; intervalSeconds: number;
    maxAttempts: number; attempts: number; delivered: number;
    lastAttemptAt: string | null; lastSuccessAt: string | null; lastError: string | null;
  };
  incidents?: {
    open: number; total: number; heldNotifications: number; pendingNotifications: number;
    deliveredNotifications: number; deadNotifications: number; deliveryEnabled: boolean;
    recent: Array<{
      key: string; category: string; subject: string; severity: "warning" | "critical";
      status: "open" | "resolved"; revision: number; openedAt: string;
      lastSeenAt: string; resolvedAt: string | null; occurrences: number;
      errorCode: string | null;
    }>;
  };
  fetchCache?: {
    entries: number; bytes: number; maxEntries: number; maxBytes: number;
  };
  discoveryCache?: {
    persistedSources: number; invalidatedSources: number;
    conditionalRequests: number; notModifiedResponses: number; freshResponses: number;
    lastUpdatedAt: string | null;
  };
  discoveryRuns?: {
    lastCompletedAt: string | null; lastDurationMs: number | null;
    lastCompletedAgeSeconds: number | null; pollOverdueAfterSeconds: number;
    pollOverdue: boolean; completedSinceStart?: boolean;
    lastChecks: number; lastDegraded: number; lastNewSources: number;
    lastRequestDurationAverageMs: number | null; lastRequestDurationMaxMs: number | null;
    runs24Hours: number; checks24Hours: number; degraded24Hours: number;
    newSources24Hours: number; requestDurationAverageMs24Hours: number | null;
    requestDurationMaxMs24Hours: number | null;
  };
  prioritySources?: {
    targetCount: number; configuredCount: number; checkedSinceStart: number;
    healthy: number; degraded: number; pending: number; omitted: number;
    completionLatencyMs: number | null;
  };
  prioritySourceRuns?: {
    lastCompletedAt: string | null; lastObservedAt: string | null;
    lastObservedAgeSeconds: number | null; configuredCount: number;
    healthy: number; degraded: number; completionLatencyMs: number | null;
    completedRuns24Hours: number;
  };
  priorityPersistence?: {
    lastAttemptAt: string | null; lastSuccessAt: string | null;
    healthy: boolean | null; lastError: string | null;
  };
  bodyFetch?: {
    lastPollAt: string | null; lastBatchAt: string | null;
    lastBatchDurationMs: number | null; lastBatchChecks: number;
    lastBatchErrors: number; lastBatchNotModified: number;
    healthy: boolean | null; consecutiveFailures: number; lastError: string | null;
    retrySeconds: number; nextRetryAt: string | null;
    durable?: {
      lastPolledAt: string | null; lastPollAgeSeconds: number | null;
      pendingAtLastPoll: number | null; pollOverdueAfterSeconds: number;
      pollOverdue: boolean; polledSinceStart?: boolean; completedSinceStart?: boolean;
      lastCompletedAt: string | null; lastDurationMs: number | null;
      lastChecks: number; lastErrors: number; lastNotModified: number;
      lastDetectionLatencySamples: number;
      lastDetectionLatencyAverageMs: number | null;
      lastDetectionLatencyMaxMs: number | null;
      lastSelectedDetectedNeverFetched: number;
      lastSelectedBaselineNeverFetched: number;
      lastSelectedExtractionPending: number;
      lastSelectedRecheck: number;
      lastErrorDetectedNeverFetched: number;
      lastErrorBaselineNeverFetched: number;
      lastErrorExtractionPending: number;
      lastErrorRecheck: number;
      runs24Hours: number; checks24Hours: number; errors24Hours: number;
      notModified24Hours: number;
      detectionLatencySamples24Hours: number;
      detectionLatencyAverageMs24Hours: number | null;
      detectionLatencyMaxMs24Hours: number | null;
      selectedDetectedNeverFetched24Hours: number;
      selectedBaselineNeverFetched24Hours: number;
      selectedExtractionPending24Hours: number;
      selectedRecheck24Hours: number;
      errorDetectedNeverFetched24Hours: number;
      errorBaselineNeverFetched24Hours: number;
      errorExtractionPending24Hours: number;
      errorRecheck24Hours: number;
    };
  };
  pendingBodies?: number;
  bodyBacklog?: {
    eligible: number; hostDeferred?: number; activeHostCircuits?: number;
    nextHostProbeAt?: string | null; dueHostCircuits?: number; scheduledHostProbes?: number;
    retryDeferred: number; accessRestricted: number;
    rateLimited?: number;
    recheckDeferred: number;
    neverFetched?: number; detectedNeverFetched?: number; baselineNeverFetched?: number;
    detectedNeverFetchedMeasured?: number; detectedNeverFetchedUnmeasured?: number;
    detectedNeverFetchedAgeMaxMs?: number | null;
    oldestDetectedNeverFetchedAt?: string | null;
    fairnessScheduled?: boolean; fairnessAgeMs?: number | null;
    fairnessSharedHost?: boolean;
    scheduledDetectedNeverFetched?: number; scheduledBaselineNeverFetched?: number;
    scheduledExtractionPending?: number; scheduledRecheck?: number;
    extractionPending?: number; extracted?: number;
    total: number; measuredAt: string | null;
  };
  bodyHostProbes?: {
    lastAttemptedAt: string | null; lastCompletedAt: string | null;
    lastOutcome: "recovered" | "restricted" | "failed" | null;
    probes24Hours: number; recovered24Hours: number;
    restricted24Hours: number; failed24Hours: number;
  };
  secEvidence?: {
    total: number; exhibit: number; direct: number; pending: number; error: number;
    errorKinds?: {
      accessRestricted: number; rateLimited: number; timeout: number;
      server: number; missingExhibit: number; other: number;
    };
    lastCheckedAt: string | null;
    byTicker: Record<string, {
      total: number; exhibit: number; direct: number; pending: number; error: number;
      errorKinds?: {
        accessRestricted: number; rateLimited: number; timeout: number;
        server: number; missingExhibit: number; other: number;
      };
      lastCheckedAt: string | null;
    }>;
  };
  signalIntake?: {
    routes: {
      configured: number; checked: number; fresh: number;
      stale: number; error: number; pending: number;
      errorKinds?: {
        accessRestricted: number; rateLimited: number; timeout: number;
        server: number; invalidResponse: number; articlePartial: number; other: number;
      };
      retry?: {
        due: number; deferred: number; unscheduled: number; nextAt: string | null;
        byErrorKind?: Partial<Record<
          "accessRestricted" | "rateLimited" | "timeout" | "server" |
          "invalidResponse" | "articlePartial" | "other",
          { due: number; deferred: number; unscheduled: number; nextAt: string | null }
        >>;
      };
      activeOutages?: {
        measured: number; unmeasured: number; ageMaxMs: number | null;
        attemptsAverage: number | null; attemptsMax: number | null;
        oldestStartedAt: string | null;
        byErrorKind?: Partial<Record<
          "accessRestricted" | "rateLimited" | "timeout" | "server" |
          "invalidResponse" | "articlePartial" | "other",
          { measured: number; unmeasured: number; ageMaxMs: number | null;
            attemptsAverage: number | null; attemptsMax: number | null;
            oldestStartedAt: string | null }
        >>;
      };
    };
    articleRetrieval?: {
      error: number;
      errorKinds: {
        accessRestricted: number; rateLimited: number; timeout: number;
        server: number; invalidResponse: number; articlePartial: number; other: number;
      };
      retry: {
        due: number; deferred: number; unscheduled: number; nextAt: string | null;
        byErrorKind?: Partial<Record<
          "accessRestricted" | "rateLimited" | "timeout" | "server" |
          "invalidResponse" | "articlePartial" | "other",
          { due: number; deferred: number; unscheduled: number; nextAt: string | null }
        >>;
      };
      recoveries24Hours?: {
        count: number; latencyAverageMs: number | null; latencyMaxMs: number | null;
        attemptsAverage: number | null; attemptsMax: number | null; lastRecoveredAt: string | null;
      };
    };
    publicationEvidence: {
      total: number; timestamp: number; dateOnly: number; missing: number;
    };
    routeTransitions24Hours?: {
      recoveries: number; failures: number; changes: number;
      lastOutcome: "recovered" | "failed" | "changed" | null;
      lastOccurredAt: string | null;
    };
    routeRecoveries24Hours?: {
      count: number; latencyAverageMs: number | null; latencyMaxMs: number | null;
      attemptsAverage: number | null; attemptsMax: number | null; lastRecoveredAt: string | null;
    };
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
