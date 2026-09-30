export const NEWS_POLL_INTERVAL_MS = 5_000;
export const NEWS_RETRY_BASE_MS = 5_000;

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
  let active: AbortController | null = null;
  let stopped = true;
  let queued = false;
  let failures = 0;

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
    const controller = new AbortController();
    active = controller;
    try {
      const value = await load(controller.signal);
      if (stopped || controller.signal.aborted) return;
      failures = 0;
      onSuccess(value);
    } catch {
      if (stopped || controller.signal.aborted) return;
      failures += 1;
      onFailure();
    } finally {
      if (active === controller) active = null;
      if (stopped) return;
      const delay = queued ? 0 : newsPollDelay(failures);
      queued = false;
      schedulePoll(delay);
    }
  };

  return {
    start(delay = 0) {
      if (!stopped) return;
      stopped = false;
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
      queued = false;
      clearTimer();
      active?.abort();
      active = null;
    },
  };
}
