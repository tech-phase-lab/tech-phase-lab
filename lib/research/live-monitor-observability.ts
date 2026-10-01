export type MonitorFallbackReason =
  | "not-configured"
  | "invalid-config"
  | "upstream-4xx"
  | "upstream-5xx"
  | "upstream-other-status"
  | "oversized-response"
  | "invalid-json"
  | "invalid-payload"
  | "timeout"
  | "network";

type SafeLogger = Pick<Console, "info" | "warn">;

export function monitorStatusReason(status: number): MonitorFallbackReason {
  if (status >= 400 && status < 500) return "upstream-4xx";
  if (status >= 500 && status < 600) return "upstream-5xx";
  return "upstream-other-status";
}

export function monitorExceptionReason(error: unknown): MonitorFallbackReason {
  if (error instanceof SyntaxError) return "invalid-json";
  if (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name)) return "timeout";
  return "network";
}

export function createMonitorFallbackLogger(logger: SafeLogger = console, quietMs = 300_000) {
  let lastFailure: { reason: MonitorFallbackReason; loggedAt: number; startedAt: number } | null = null;

  return {
    failure(reason: MonitorFallbackReason, now = Date.now()) {
      if (lastFailure?.reason === reason && now - lastFailure.loggedAt < quietMs) return;
      lastFailure = { reason, loggedAt: now, startedAt: lastFailure?.startedAt ?? now };
      logger.warn("[research-live] monitor fallback", { reason });
    },
    recovered(now = Date.now()) {
      if (!lastFailure) return;
      const previousReason = lastFailure.reason;
      const elapsedMs = Math.max(0, now - lastFailure.startedAt);
      lastFailure = null;
      logger.info("[research-live] monitor recovered", { previousReason, elapsedMs });
    },
  };
}
