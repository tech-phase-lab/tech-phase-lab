"use client";
import { useEffect, useState } from "react";

/** The current time, refreshed on every minute boundary (null until the page is on the screen, so the server page and the first paint agree).
 * The market board and the stock pages use it to know whether it is pre-market or after-hours now. */
export function useMinute(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => { const at = Date.now(); setNow(at); timer = setTimeout(tick, 60_000 - (at % 60_000) + 50); };
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, []);
  return now;
}

/** The current time, refreshed on every second boundary (null until the page is on the screen). The market board's status line shows it as a
 * running clock (owner, Nov 24: the pre-market time did not move); a hidden tab does not tick and catches up the moment it is shown. */
export function useSecond(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      clearTimeout(timer);
      const at = Date.now();
      setNow(at);
      if (document.visibilityState !== "hidden") timer = setTimeout(tick, 1000 - (at % 1000) + 20);
    };
    const shown = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", shown);
    timer = setTimeout(tick, 0);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", shown); };
  }, []);
  return now;
}
