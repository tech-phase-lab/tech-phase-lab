import { useMemo, useSyncExternalStore } from "react";

/** The current minute, ticking every 30 seconds. It is 0 on the server, so the first paint never disagrees with it. */
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
function subscribe(notify: () => void) {
  listeners.add(notify);
  timer ??= setInterval(() => listeners.forEach(listener => listener()), 30_000);
  return () => { listeners.delete(notify); if (!listeners.size && timer) { clearInterval(timer); timer = undefined; } };
}
const snapshot = () => Math.floor(Date.now() / 60_000);
export const useMinuteClock = () => useSyncExternalStore(subscribe, snapshot, () => 0);

/** A note carries the NEW tag for 30 minutes after it is posted (owner, Nov 16). */
export const NEW_TAG_MS = 30 * 60_000;
/** True for the first 30 minutes after the post time. `now` is in milliseconds; 0 (the server) is never fresh. */
export const isFresh = (now: number, publishedAt: string) => {
  const age = now - Date.parse(publishedAt);
  return now > 0 && age >= -60_000 && age < NEW_TAG_MS;
};
type Dated = { id: string; kind?: string; publishedAt: string | null };
/** The newest note, which is the only one that may carry NEW (owner, Nov 16: never two NEW tags at once). */
export function newestNote<T extends Dated>(items: readonly T[]): T | null {
  let newest: T | null = null;
  for (const item of items) {
    if (item.kind !== undefined && item.kind !== "notes") continue;
    const at = Date.parse(item.publishedAt ?? "");
    if (Number.isFinite(at) && (!newest || at > Date.parse(newest.publishedAt!))) newest = item;
  }
  return newest;
}
/** The id of the note that shows NEW at `now`, or null. */
export function newNoteId(items: readonly Dated[], now: number) {
  const newest = newestNote(items);
  return newest && isFresh(now, newest.publishedAt!) ? newest.id : null;
}
/**
 * Live NEW id: re-checked exactly when the 30 minutes end (no reload needed), every 30 seconds,
 * and when the page comes back to the screen (a phone pauses timers in the background).
 */
export function useNewNoteId(items: readonly Dated[]) {
  const newest = newestNote(items);
  const at = newest ? Date.parse(newest.publishedAt!) : NaN;
  const store = useMemo(() => ({
    subscribe(notify: () => void) {
      const timers: ReturnType<typeof setTimeout>[] = [];
      for (const edge of [at - 60_000, at + NEW_TAG_MS]) {
        const wait = edge - Date.now();
        if (Number.isFinite(wait) && wait > 0) timers.push(setTimeout(notify, Math.min(wait + 50, 2_147_483_647)));
      }
      const tick = setInterval(notify, 30_000);
      const wake = () => notify();
      document.addEventListener("visibilitychange", wake); window.addEventListener("pageshow", wake); window.addEventListener("focus", wake);
      return () => {
        timers.forEach(clearTimeout); clearInterval(tick);
        document.removeEventListener("visibilitychange", wake); window.removeEventListener("pageshow", wake); window.removeEventListener("focus", wake);
      };
    },
    read: () => newest !== null && isFresh(Date.now(), newest.publishedAt!),
  }), [at, newest]);
  const fresh = useSyncExternalStore(store.subscribe, store.read, () => false);
  return fresh && newest ? newest.id : null;
}

/** Owner tools stay mounted while the membership is only being re-checked; a finished check that says "not the owner" removes them. */
export const nextSteadyOwner = (steady: boolean, ownerMode: boolean, settled: boolean) => ownerMode ? true : settled ? false : steady;
