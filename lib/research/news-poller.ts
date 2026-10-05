import { isNewsStreamLive, subscribeNewsChanges } from "./news-stream.ts";

export const NEWS_POLL_INTERVAL_MS = 5_000;
// With a healthy push connection, polling is only a safety net.
export const NEWS_PUSH_SAFETY_INTERVAL_MS = 30_000;
export const NEWS_RETRY_BASE_MS = 5_000;
export const NEWS_REQUEST_TIMEOUT_MS = 15_000;

export function newsPollDelay(consecutiveFailures: number, pushLive = false) {
  if (consecutiveFailures <= 0) return pushLive ? NEWS_PUSH_SAFETY_INTERVAL_MS : NEWS_POLL_INTERVAL_MS;
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
  /** Refresh immediately when the server signals a news change. */
  push?: boolean;
};

export function createNewsPoller<T>({
  load,
  onSuccess,
  onFailure,
  schedule = setTimeout,
  cancel = clearTimeout,
  push = false,
}: NewsPollerOptions<T>) {
  let unsubscribe: (() => void) | null = null;
  let timer: Timer | null = null;
  let active: { controller: AbortController; timeout: Timer } | null = null;
  let stopped = true;
  let queued = false;
  let failures = 0;
  let session = 0;
  let resumedAt = -Infinity;

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

  const pause = () => {
    session += 1;
    queued = false;
    resumedAt = -Infinity;
    clearTimer();
    if (active) {
      cancel(active.timeout);
      active.controller.abort();
      active = null;
    }
  };

  const poll = async () => {
    if (stopped) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") { pause(); return; }
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
      const delay = queued ? 0 : newsPollDelay(failures, push && isNewsStreamLive());
      queued = false;
      schedulePoll(delay);
    }
  };

  const poller = {
    start(delay = 0) {
      if (!stopped) return;
      stopped = false;
      session += 1;
      schedulePoll(Math.max(0, delay));
      if (push && !unsubscribe) unsubscribe = subscribeNewsChanges(() => poller.wake());
    },
    wake() {
      if (stopped) return;
      clearTimer();
      if (active) queued = true;
      else schedulePoll(0);
    },
    pause,
    resume() {
      if (stopped || active || Date.now() - resumedAt < 1_000) return;
      resumedAt = Date.now();
      // Resume never waits behind a fetch which was suspended in the background.
      // Coalesce focus/pageshow/visibilitychange into one fresh read.
      schedulePoll(0);
    },
    stop() {
      stopped = true;
      unsubscribe?.();
      unsubscribe = null;
      pause();
    },
  };
  return poller;
}
