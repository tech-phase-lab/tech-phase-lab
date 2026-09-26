"use client";

import { useSyncExternalStore } from "react";

function subscribeClock(notify: () => void) {
  const timer = window.setInterval(notify, 60000);
  document.addEventListener("visibilitychange", notify);
  return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", notify); };
}
function clockSnapshot() { return Math.floor(Date.now() / 60000) * 60000; }
const serverSnapshot = () => null;

export function useCalendarClock() {
  return useSyncExternalStore(subscribeClock, clockSnapshot, serverSnapshot);
}
