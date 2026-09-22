"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import styles from "./back-to-top.module.css";

function subscribe(notify: () => void) {
  window.addEventListener("scroll", notify, { passive: true });
  return () => window.removeEventListener("scroll", notify);
}
const snapshot = () => window.scrollY > 600;
const serverSnapshot = () => false;

export default function BackToTop() {
  const pathname = usePathname();
  const visible = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  if (!visible || pathname === "/research/stocks/widget") return null;
  function goToTop() {
    window.scrollTo({ top: 0, behavior: "instant" });
    document.querySelector<HTMLElement>("header a")?.focus({ preventScroll: true });
  }
  return <button type="button" className={styles.button} onClick={goToTop}
    aria-label="ページ上部へ戻る / Back to top" title="ページ上部へ戻る / Back to top">
    <span aria-hidden="true">↑</span>
  </button>;
}
