import { useSyncExternalStore } from "react";

/** The current minute, ticking every 30 seconds, for "posted within the hour" badges. It is 0 on the server, so the first paint never disagrees with it. */
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
function subscribe(notify: () => void) {
  listeners.add(notify);
  timer ??= setInterval(() => listeners.forEach(listener => listener()), 30_000);
  return () => { listeners.delete(notify); if (!listeners.size && timer) { clearInterval(timer); timer = undefined; } };
}
const snapshot = () => Math.floor(Date.now() / 60_000);
export const useMinuteClock = () => useSyncExternalStore(subscribe, snapshot, () => 0);
/** True for the first 60 minutes after the post time. */
export const isFresh = (minute: number, publishedAt: string) => { const age = minute * 60_000 - Date.parse(publishedAt); return minute > 0 && age >= -60_000 && age < 3_600_000; };
