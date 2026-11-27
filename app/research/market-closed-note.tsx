"use client";
import { useEffect, useState } from "react";
import { marketClosedNotice } from "@/lib/research/us-market-session";
import styles from "./market-closed-note.module.css";

/** One quiet line on a day the U.S. market is closed (owner, Nov 27): weekends and NYSE holidays, by the U.S. Eastern date. A small
 * bordered box with a megaphone, on one line. Drawn after the page has a clock (no server-rendered date) and checked every minute,
 * so it appears and goes away at New York midnight. `place` picks the home spot: the side menu (wide screens) or the page (phones). */
export default function MarketClosedNote({ lang, place }: { lang: "ja" | "en"; place: "side" | "page" }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setText(marketClosedNotice(new Date(), lang));
    read();
    const timer = window.setInterval(read, 60_000);
    return () => window.clearInterval(timer);
  }, [lang]);
  if (!text) return null;
  return <p className={`${styles.note} ${place === "side" ? styles.side : styles.page}`} role="note" data-market-closed-note="">
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10v4a1 1 0 0 0 1 1h2l5 4V5L6 9H4a1 1 0 0 0-1 1z" /><path d="M15 9a4 4 0 0 1 0 6" /><path d="M18 6.5a8 8 0 0 1 0 11" />
    </svg>
    <span>{text}</span>
  </p>;
}
