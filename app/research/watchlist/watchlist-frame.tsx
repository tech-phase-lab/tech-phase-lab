"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./watchlist-frame.module.css";

export default function WatchlistFrame({ children, lang }: { children: ReactNode; lang: "ja" | "en" }) {
  const frame = useRef<HTMLDivElement>(null);
  const cue = useRef<HTMLDivElement>(null);
  const [direction, setDirection] = useState<"down" | "up" | null>(null);

  useEffect(() => {
    const main = frame.current?.querySelector("main");
    if (!main) return;
    let pending = 0;
    const update = () => {
      pending = 0;
      const rows = main.querySelector("[data-watchlist-rows]");
      const edge = cue.current?.getBoundingClientRect().bottom ?? window.innerHeight;
      const hasRows = Boolean(rows?.childElementCount);
      setDirection(hasRows && rows!.getBoundingClientRect().bottom > edge + 2 ? "down" : hasRows && window.scrollY > 80 ? "up" : null);
    };
    const schedule = () => {
      if (!pending) pending = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(main);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    schedule();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(pending);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  }, []);

  return <div className={styles.frame} ref={frame}>
    {children}
    <div className={styles.cue} ref={cue}>
      <button type="button" hidden={!direction} aria-label={direction === "up" ? (lang === "ja" ? "ウォッチリストの上部へ戻る" : "Back to watchlist top") : (lang === "ja" ? "下の銘柄を見る" : "See more stocks below")} onClick={() => {
        const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
        if (direction === "up") window.scrollTo({ top: 0, behavior });
        else window.scrollBy({ top: window.innerHeight * .65, behavior });
      }}>
        <span aria-hidden="true">{direction === "up" ? "▲" : "▼"}</span>
      </button>
    </div>
  </div>;
}
