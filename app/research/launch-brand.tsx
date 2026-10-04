"use client";
import { useEffect, useRef } from "react";
import styles from "./launch-brand.module.css";

/** Decorative only: never waits for APIs, blocks input, or replays on resume. */
export default function LaunchBrand() {
  const overlay = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = overlay.current;
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (!element || !standalone || document.visibilityState !== "visible") return;
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (navigation?.type === "reload" || navigation?.type === "back_forward") return;
    try {
      if (sessionStorage.getItem("tech-phase:launch-seen")) return;
      sessionStorage.setItem("tech-phase:launch-seen", "1");
    } catch { return; }
    element.hidden = false;
    const dismiss = () => { element.hidden = true; };
    const hidden = () => { if (document.visibilityState !== "visible") dismiss(); };
    const timer = window.setTimeout(dismiss, 1200);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", dismiss);
    return () => { dismiss(); window.clearTimeout(timer); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", dismiss); };
  }, []);
  return <div ref={overlay} hidden aria-hidden="true" className={styles.launch}>
    <div className={styles.wordmark}><strong>Tech Phase</strong><span>Research</span></div>
  </div>;
}
