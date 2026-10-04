export const NEWS_POLL_INTERVAL_MS = 5_000;
export const NEWS_RETRY_BASE_MS = 5_000;
export const NEWS_REQUEST_TIMEOUT_MS = 15_000;

export function newsPollDelay(consecutiveFailures: number) {
  if (consecutiveFailures <= 0) return NEWS_POLL_INTERVAL_MS;
  return Math.min(
    30_000,
    NEWS_RETRY_BASE_MS * (2 ** Math.min(consecutiveFailures - 1, 3)),
  );
}

type Timer = ReturnType<typeof setTimeout>;
type NewsPollerOptions<T> = {
  load: (signal: AbortSignal) => Promise<T>;
  onSuccess: (value: T) => void;
  onFailure: () => void;
  schedule?: (callback: () => void, delay: number) => Timer;
  cancel?: (timer: Timer) => void;
};

export function createNewsPoller<T>({
  load,
  onSuccess,
  onFailure,
  schedule = setTimeout,
  cancel = clearTimeout,
}: NewsPollerOptions<T>) {
  let timer: Timer | null = null;
  let active: { controller: AbortController; timeout: Timer } | null = null;
  let stopped = true;
  let queued = false;
  let failures = 0;
  let session = 0;

  const clearTimer = () => {
    if (timer !== null) cancel(timer);
    timer = null;
  };

  const schedulePoll = (delay: number) => {
    clearTimer();
    timer = schedule(() => {
      timer = null;
      void poll();
    }, delay);
  };

  const poll = async () => {
    if (stopped) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") { schedulePoll(30_000); return; }
    if (active) {
      queued = true;
      return;
    }
    const revision = session;
    const controller = new AbortController();
    let rejectAbort: (reason: unknown) => void = () => {};
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const onAbort = () => rejectAbort(controller.signal.reason);
    controller.signal.addEventListener("abort", onAbort, { once: true });
    const request = {
      controller,
      timeout: schedule(() => controller.abort(new Error("News request timed out")), NEWS_REQUEST_TIMEOUT_MS),
    };
    active = request;
    try {
      // Bound the entire load, including a stalled response body. Race the
      // deadline too: a loader which ignores cancellation must not stop polls.
      const value = await Promise.race([load(controller.signal), aborted]);
      if (stopped || revision !== session || controller.signal.aborted) return;
      failures = 0;
      onSuccess(value);
    } catch {
      if (stopped || revision !== session) return;
      failures += 1;
      onFailure();
    } finally {
      cancel(request.timeout);
      controller.signal.removeEventListener("abort", onAbort);
      if (active === request) active = null;
      if (stopped || revision !== session) return;
      const delay = queued ? 0 : newsPollDelay(failures);
      queued = false;
      schedulePoll(delay);
    }
  };

  return {
    start(delay = 0) {
      if (!stopped) return;
      stopped = false;
      session += 1;
      schedulePoll(Math.max(0, delay));
    },
    wake() {
      if (stopped) return;
      clearTimer();
      if (active) queued = true;
      else schedulePoll(0);
    },
    stop() {
      stopped = true;
      session += 1;
      queued = false;
      clearTimer();
      if (active) {
        cancel(active.timeout);
        active.controller.abort();
      }
      active = null;
    },
  };
}
