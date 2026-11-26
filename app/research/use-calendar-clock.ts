"use client";

import { useSyncExternalStore } from "react";

function subscribeClock(notify: () => void) {
  const timer = window.setInterval(notify, 60000);
  document.addEventListener("visibilitychange", notify);
  return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", notify); };
}
function clockSnapshot() { return Math.floor(Date.now() / 60000) * 60000; }
const serverSnapshot = () => null;

/** `drawnAt`: the minute the server drew the page at (the calendar's first HTML, speed Nov 26). The server's HTML and the first render in
 * the browser use it, so they match; the browser's own clock takes over right after. */
export function useCalendarClock(drawnAt: number | null = null) {
  return useSyncExternalStore(subscribeClock, clockSnapshot, drawnAt === null ? serverSnapshot : () => drawnAt);
}
