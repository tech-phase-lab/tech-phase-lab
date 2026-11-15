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
