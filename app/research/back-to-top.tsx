"use client";

import Link from "next/link";
import NavigationIcon from "./navigation-icon";
import { useResearchLanguage } from "./use-research-language";
import { useSyncExternalStore, type MouseEvent } from "react";
import { usePathname } from "next/navigation";
import styles from "./back-to-top.module.css";

function subscribe(notify: () => void) {
  window.addEventListener("scroll", notify, { passive: true });
  return () => window.removeEventListener("scroll", notify);
}
const snapshot = () => window.scrollY > 600;
const serverSnapshot = () => false;

export default function BackToTop() {
  const [lang] = useResearchLanguage();
  const pathname = usePathname();
  const visible = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  if (pathname === "/research/stocks/widget") return null;
  function goHome(event: MouseEvent<HTMLAnchorElement>) {
    if (pathname !== "/research") return;
    event.preventDefault();
    if (window.location.hash !== "#research-main") window.history.pushState(null, "", "/research#research-main");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    document.getElementById("research-main")?.scrollIntoView({ behavior: "instant", block: "start" });
  }
  function goToTop() {
    window.scrollTo({ top: 0, behavior: "instant" });
    document.querySelector<HTMLElement>("header a")?.focus({ preventScroll: true });
  }
  return <div className={styles.dock}>
    <Link href="/research#research-main" onClick={goHome} className={styles.home} aria-label={lang === "ja" ? "ホームへ戻る" : "Back to home"}><NavigationIcon name="home" /><span>{lang === "ja" ? "ホーム" : "Home"}</span></Link>
    {visible && <button type="button" className={styles.button} onClick={goToTop}
    aria-label="ページ上部へ戻る / Back to top" title="ページ上部へ戻る / Back to top">
    <span aria-hidden="true">↑</span>
  </button>}
  </div>;
}
