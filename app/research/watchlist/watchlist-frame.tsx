"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./watchlist-frame.module.css";

export default function WatchlistFrame({ children, lang }: { children: ReactNode; lang: "ja" | "en" }) {
  const frame = useRef<HTMLDivElement>(null);
  const cue = useRef<HTMLDivElement>(null);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    const main = frame.current?.querySelector("main");
    if (!main) return;
    let pending = 0;
    const update = () => {
      pending = 0;
      const rows = main.querySelector("[data-watchlist-rows]");
      const edge = cue.current?.getBoundingClientRect().bottom ?? window.innerHeight;
      setHasMore(Boolean(rows?.childElementCount && rows.getBoundingClientRect().bottom > edge + 2));
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
      <button type="button" hidden={!hasMore} aria-label={lang === "ja" ? "下の銘柄を見る" : "See more stocks below"} onClick={() => window.scrollBy({ top: window.innerHeight * .65, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" })}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14m-6-6 6 6 6-6" /></svg>
      </button>
    </div>
  </div>;
}
