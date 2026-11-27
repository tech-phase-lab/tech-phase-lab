"use client";
import { useState, type ReactNode } from "react";
import { nextFlash, startFlash } from "@/lib/research/value-flash";
import styles from "./flash-value.module.css";

/** A price that turns mint when it rises and red when it falls, then fades back over about 1.3 seconds (owner, Nov 13: the watchlist and a
 * stock's page). Only a real new value from the server does this: never the first value shown, nor a switch to another stock (`scope`).
 * `quick` (a stock's page, owner Nov 27: the live price ticking): the same text-colour flash, 0.7 seconds. Reduced motion: no colour change (CSS). */
export default function FlashValue({ scope, value, className = "", quick = false, children }: { scope: string; value: number | null; className?: string; quick?: boolean; children: ReactNode }) {
  const [state, setState] = useState(() => startFlash(scope, value));
  const next = nextFlash(state, scope, value);
  if (next !== state) setState(next);
  const tone = next.dir === "up" ? (quick ? styles.quickUp : styles.up) : next.dir === "down" ? (quick ? styles.quickDown : styles.down) : "";
  return <span key={next.n} className={`${className} ${tone}`.trim()}>{children}</span>;
}
