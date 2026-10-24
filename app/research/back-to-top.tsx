"use client";

import { useSyncExternalStore, type MouseEvent } from "react";
import { usePathname } from "next/navigation";
import { useResearchLanguage } from "./use-research-language";
import styles from "./back-to-top.module.css";

function subscribe(notify: () => void) {
  window.addEventListener("scroll", notify, { passive: true });
  return () => window.removeEventListener("scroll", notify);
}
const phone = () => typeof window.matchMedia === "function" && window.matchMedia("(max-width:760px)").matches;
// Phones show the button earlier (owner, Oct 14); desktop keeps its distance.
const snapshot = () => window.scrollY > (phone() ? 400 : 600);
const serverSnapshot = () => false;

export default function BackToTop() {
  const pathname = usePathname();
  const [lang] = useResearchLanguage();
  const visible = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const ja = lang === "ja";
  const name = ja ? "ページの先頭へ戻る" : "Back to top";
  if (pathname === "/research/stocks/widget") return null;
  function goToTop(event: MouseEvent<HTMLButtonElement>) {
    const smooth = typeof window.matchMedia === "function" && phone() && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "instant" });
    // Keep keyboard navigation at the top without focusing the logo after a tap.
    if (event.detail === 0) document.querySelector<HTMLElement>("header a")?.focus({ preventScroll: true });
  }
  return <div className={styles.dock}>
    <button type="button" className={`${styles.button} ${visible ? styles.show : ""}`} onClick={goToTop}
      aria-label={name} title={name} aria-hidden={visible ? undefined : true} tabIndex={visible ? 0 : -1}>
      <span className={styles.glyph} aria-hidden="true">↑</span>
      <svg className={styles.arrow} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
      <span className={styles.label} aria-hidden="true">{ja ? "先頭へ" : "Top"}</span>
    </button>
  </div>;
}
