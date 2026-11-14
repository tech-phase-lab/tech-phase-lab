"use client";
import { useState, type ReactNode } from "react";
import { nextFlash, startFlash } from "@/lib/research/value-flash";
import styles from "./flash-value.module.css";

/** A price that turns mint when it rises and red when it falls, then fades back over about 1.3 seconds (owner, Nov 13: the watchlist and a
 * stock's page). Only a real new value from the server does this: never the first value shown, nor a switch to another stock (`scope`).
 * Reduced motion: no colour change (CSS). */
export default function FlashValue({ scope, value, className = "", children }: { scope: string; value: number | null; className?: string; children: ReactNode }) {
  const [state, setState] = useState(() => startFlash(scope, value));
  const next = nextFlash(state, scope, value);
  if (next !== state) setState(next);
  const tone = next.dir === "up" ? styles.up : next.dir === "down" ? styles.down : "";
  return <span key={next.n} className={`${className} ${tone}`.trim()}>{children}</span>;
}
