"use client";

import { useEffect, useState } from "react";
import { snapshotIssues, type IntakeSnapshot } from "./intake";
import { parseMonitorFallbackReason, type MonitorFallbackReason } from "./live-monitor-diagnostics";

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
    issues: Array<"monitor-stale" | "backup-failed" | "backup-overdue" | "incident-watch-failed" | "body-fetch-failed" | "body-fetch-stale" | "discovery-poll-stale" | "priority-source-pending" | "priority-source-degraded" | "priority-source-metrics-failed" | "web-push-stale">;
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
  webPush?: {
    enabled: boolean; status: "disabled" | "waiting" | "ready" | "error";
    intervalSeconds: number; activeDevices: number; maxDevices: number;
    attempted: number; accepted: number; uncertain: number;
    attempted24Hours: number; accepted24Hours: number; uncertain24Hours: number;
    expired24Hours: number; polls: number; failures: number;
    detectionToAttemptSamples24Hours: number;
    detectionToAttemptAverageMs24Hours: number | null;
    detectionToAttemptMaxMs24Hours: number | null;
    providerResponseSamples24Hours: number;
    providerResponseAverageMs24Hours: number | null;
    providerResponseMaxMs24Hours: number | null;
    detectionToOutcomeSamples24Hours: number;
    detectionToOutcomeAverageMs24Hours: number | null;
    detectionToOutcomeMaxMs24Hours: number | null;
    consecutiveFailures: number; recoveries: number;
    lastPollAt: string | null; lastSuccessAt: string | null;
    lastFailureAt: string | null; lastAttemptAt: string | null;
    lastPollAgeSeconds: number | null; pollOverdueAfterSeconds: number;
    pollOverdue: boolean;
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
  priceTargetStream?: {
    healthy: boolean; active: boolean; checkedSinceStart: boolean; clients: number; maxClients: number;
    connectionsAccepted: number; connectionsRejected: number; disconnects: number;
    readAttempts: number; snapshotReads: number; readFailures: number;
    consecutiveFailures: number; recoveries: number; changes: number; bytesSent: number;
    lastReadAt: string | null; lastSuccessAt: string | null; lastFailureAt: string | null;
    startedAt: string; measuredAt: string;
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
  muEarningsMeasurement?: {
    status: "waiting-for-release" | "waiting" | "running" | "retry" | "complete" | "expired-without-release";
    configured?: boolean; experimentExpiresAt?: string; attempts?: number;
    eventRows?: number; candidateReasons?: Record<string, number>;
    detectedAt?: string; bodyReadyAt?: string | null;
    detectionToBodyMs: number | null;
    translationStartedAt?: string | null; translationCompletedAt?: string | null;
    translationMs: number | null; translationScope: "headline";
    summaryStartedAt?: string | null; summaryCompletedAt?: string | null;
    summaryMs: number | null; summaryPublication: "private-draft";
    bodyToSummaryMs: number | null; detectionToSummaryMs: number | null;
    modelRequestTotalMs: number | null;
    publicationToDetectionMs: number | null;
    publicationPrecision: "not-yet-confirmed" | "date-only" | "timestamp";
    inputChars?: number; inputTruncated?: boolean;
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
      lastEligibilityWaitSamples: number;
      lastEligibilityWaitAverageMs: number | null;
      lastEligibilityWaitMaxMs: number | null;
      lastRequestDurationSamples: number;
      lastRequestDurationAverageMs: number | null;
      lastRequestDurationMaxMs: number | null;
      lastRequestSuccessDurationSamples: number;
      lastRequestSuccessDurationAverageMs: number | null;
      lastRequestSuccessDurationMaxMs: number | null;
      lastRequestErrorDurationSamples: number;
      lastRequestErrorDurationAverageMs: number | null;
      lastRequestErrorDurationMaxMs: number | null;
      lastSelectedDetectedNeverFetched: number;
      lastSelectedBaselineNeverFetched: number;
      lastSelectedExtractionPending: number;
      lastSelectedRecheck: number;
      lastErrorDetectedNeverFetched: number;
      lastErrorBaselineNeverFetched: number;
      lastErrorExtractionPending: number;
      lastErrorRecheck: number;
      lastNotModifiedDetectedNeverFetched: number;
      lastNotModifiedBaselineNeverFetched: number;
      lastNotModifiedExtractionPending: number;
      lastNotModifiedRecheck: number;
      lastFetchedDetectedNeverFetched: number;
      lastFetchedBaselineNeverFetched: number;
      lastFetchedExtractionPending: number;
      lastFetchedRecheck: number;
      lastUpdatedDetectedNeverFetched: number;
      lastUpdatedBaselineNeverFetched: number;
      lastUpdatedExtractionPending: number;
      lastUpdatedRecheck: number;
      runs24Hours: number; checks24Hours: number; errors24Hours: number;
      notModified24Hours: number;
      detectionLatencySamples24Hours: number;
      detectionLatencyAverageMs24Hours: number | null;
      detectionLatencyMaxMs24Hours: number | null;
      eligibilityWaitSamples24Hours: number;
      eligibilityWaitAverageMs24Hours: number | null;
      eligibilityWaitMaxMs24Hours: number | null;
      requestDurationSamples24Hours: number;
      requestDurationAverageMs24Hours: number | null;
      requestDurationMaxMs24Hours: number | null;
      requestSuccessDurationSamples24Hours: number;
      requestSuccessDurationAverageMs24Hours: number | null;
      requestSuccessDurationMaxMs24Hours: number | null;
      requestErrorDurationSamples24Hours: number;
      requestErrorDurationAverageMs24Hours: number | null;
      requestErrorDurationMaxMs24Hours: number | null;
      selectedDetectedNeverFetched24Hours: number;
      selectedBaselineNeverFetched24Hours: number;
      selectedExtractionPending24Hours: number;
      selectedRecheck24Hours: number;
      errorDetectedNeverFetched24Hours: number;
      errorBaselineNeverFetched24Hours: number;
      errorExtractionPending24Hours: number;
      errorRecheck24Hours: number;
      notModifiedDetectedNeverFetched24Hours: number;
      notModifiedBaselineNeverFetched24Hours: number;
      notModifiedExtractionPending24Hours: number;
      notModifiedRecheck24Hours: number;
      fetchedDetectedNeverFetched24Hours: number;
      fetchedBaselineNeverFetched24Hours: number;
      fetchedExtractionPending24Hours: number;
      fetchedRecheck24Hours: number;
      outcomeUnmeasuredDetectedNeverFetched24Hours: number;
      outcomeUnmeasuredBaselineNeverFetched24Hours: number;
      outcomeUnmeasuredExtractionPending24Hours: number;
      outcomeUnmeasuredRecheck24Hours: number;
      updatedDetectedNeverFetched24Hours: number;
      updatedBaselineNeverFetched24Hours: number;
      updatedExtractionPending24Hours: number;
      updatedRecheck24Hours: number;
    };
  };
  pendingBodies?: number;
  bodyBacklog?: {
    eligible: number; hostDeferred?: number; activeHostCircuits?: number;
    nextHostProbeAt?: string | null; dueHostCircuits?: number; scheduledHostProbes?: number;
    retryDeferred: number; accessRestricted: number;
    rateLimited?: number;
    errorKinds?: {
      accessRestricted: number; rateLimited: number; timeout: number;
      server: number; extraction: number; invalidResponse: number; other: number;
    };
    invalidRetrySchedules?: number;
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
    canonicalAliasRows?: number; canonicalDuplicateGroups?: number;
    canonicalDuplicateRows?: number; canonicalInvalidRows?: number;
    total: number; measuredAt: string | null;
  };
  bodyHostProbes?: {
    lastEligibleAt: string | null;
    lastAttemptedAt: string | null; lastCompletedAt: string | null;
    lastOutcome: "recovered" | "restricted" | "failed" | null;
    lastEligibilityWaitMs: number | null;
    probes24Hours: number; recovered24Hours: number;
    restricted24Hours: number; failed24Hours: number;
    eligibilityWaitSamples24Hours: number;
    eligibilityWaitAverageMs24Hours: number | null;
    eligibilityWaitMaxMs24Hours: number | null;
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
      configured: number; suspended?: number; checked: number; fresh: number;
      stale: number; error: number; pending: number;
      errorKinds?: {
        accessRestricted: number; rateLimited: number; timeout: number;
        server: number; invalidResponse: number; articlePartial: number;
        fetchFailure?: number; noLinks?: number; other: number;
      };
      retry?: {
        due: number; deferred: number; unscheduled: number; nextAt: string | null;
        byErrorKind?: Partial<Record<
          "accessRestricted" | "rateLimited" | "timeout" | "server" |
          "invalidResponse" | "articlePartial" | "fetchFailure" | "noLinks" | "other",
          { due: number; deferred: number; unscheduled: number; nextAt: string | null }
        >>;
      };
      activeOutages?: {
        measured: number; unmeasured: number; ageMaxMs: number | null;
        attemptsAverage: number | null; attemptsMax: number | null;
        oldestStartedAt: string | null;
        byErrorKind?: Partial<Record<
          "accessRestricted" | "rateLimited" | "timeout" | "server" |
          "invalidResponse" | "articlePartial" | "fetchFailure" | "noLinks" | "other",
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
        server: number; invalidResponse: number; articlePartial: number;
        fetchFailure?: number; noLinks?: number; other: number;
      };
      retry: {
        due: number; deferred: number; unscheduled: number; nextAt: string | null;
        byErrorKind?: Partial<Record<
          "accessRestricted" | "rateLimited" | "timeout" | "server" |
          "invalidResponse" | "articlePartial" | "fetchFailure" | "noLinks" | "other",
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
    publicationToDetectionLatency24Hours?: {
      count: number; latencyAverageMs: number | null; latencyMaxMs: number | null;
      lastObservedAt: string | null;
    };
    officialResearch?: { published: number; pending: number;
      delivery?: { tracked: number; validated: number; automaticPending: number; retryWaiting: number; running: number;
        reviewHeld: number; publicationHeld: number; assessedExcluded: number; unpublished: number; unfinished?: number; partialPublished?: number; reviewOverdue: number; automaticOverdue: number;
        reviewOldestCaptureAgeMs: number | null; reviewOldestPublicationAgeMs: number | null; reviewPublicationAgeUnmeasured: number };
      latest: { id: string; ticker: string; observedAt: string; bodyReadyAt: string; generationStartedAt: string; publicAt: string; generationMs: number; detectionToPublicMs: number | null }[]; jobs: { event_id: number; state: string; attempts: number; failure_kind: string | null }[] };
    headlineTranslation?: {
      status: "disabled" | "approval-required" | "misconfigured" | "enabled";
      dailyLimit: number | null;
      eligible: number; translated: number; pending: number;
      running: number; retrying: number; exhausted: number;
      failureKinds?: Record<string, number>;
      oldestPendingAt: string | null; nextRetryAt: string | null;
      calls24Hours: { total: number; failed: number; completed: number; stale: number };
    };
    xMarketNews?: { accounts: number; eligible: number; published: number; pending: number; failureKinds: Record<string, number> };
    analystNews?: { eligible: number; published: number; pending: number; excluded: number; rejectionReasons: Record<string, number> };
    xIntake?: {
      usage: {
        requested: boolean; configured: boolean; enabled: boolean;
        attemptsLast24Hours: number; dailyLimit: number; limitReached: boolean;
      };
      routes: {
        checked: number; error: number; latestCheckedAt: string | null;
        latestSucceededAt: string | null;
      };
      items24Hours?: {
        total: number; analystRatings: number; priceTargets: number;
        earnings: number; officialUpdates: number; other: number;
        latestObservedAt: string | null;
      };
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
    routeRetryWait24Hours?: {
      count: number; waitAverageMs: number | null; waitMaxMs: number | null;
      lastAttemptedAt: string | null;
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
  diagnosticReason: MonitorFallbackReason | null;
};

export function useLiveIntake(initialSnapshot: IntakeSnapshot, intervalMs = 60_000) {
  const [state, setState] = useState<LiveState>({ snapshot: initialSnapshot, mode: "snapshot", monitor: null, error: null, diagnosticReason: null });

  useEffect(() => {
    let active = true;
    let inFlight = false;
    async function refresh() {
      if (!active || document.hidden || inFlight) return;
      inFlight = true;
      try {
        const response = await fetch("/api/research/live");
        const payload = await response.json() as { mode?: "automatic" | "snapshot"; monitor?: MonitorState; error?: LiveState["error"]; diagnosticReason?: unknown; snapshot?: IntakeSnapshot };
        if (!active || !payload.snapshot || snapshotIssues(payload.snapshot).length) return;
        setState({
          snapshot: payload.snapshot,
          mode: payload.mode === "automatic" ? "automatic" : "snapshot",
          monitor: payload.mode === "automatic" ? payload.monitor ?? null : null,
          error: payload.error ?? null,
          diagnosticReason: payload.mode === "automatic" ? null : parseMonitorFallbackReason(payload.diagnosticReason),
        });
      } catch {
        if (active) setState((current) => ({ ...current, mode: "snapshot", monitor: null, error: "monitor-unavailable", diagnosticReason: null }));
      } finally {
        inFlight = false;
      }
    }
    const onVisibilityChange = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    const initial = window.setTimeout(() => { void refresh(); }, 0);
    const timer = window.setInterval(() => { void refresh(); }, intervalMs);
    return () => {
      active = false;
      window.clearTimeout(initial);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs]);

  return state;
}
