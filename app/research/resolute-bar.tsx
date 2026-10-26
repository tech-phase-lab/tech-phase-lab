"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useResearchLanguage } from "./use-research-language";
import styles from "./resolute-bar.module.css";

/** RESOLUTE's standing bar (owner, Oct 26): home screen on phones only, just above the bottom menu.
 * Never shown to anyone with an active RESOLUTE purchase, and never while that is still unknown: it appears only after the
 * entitlement answer says "no purchase" (or the visitor is signed out). "×" hides it for seven days. */
const KEY = "tech-phase:resolute-bar-dismissed";
const WEEK = 7 * 24 * 3_600_000;

function dismissedRecently() {
  try { const at = Number(localStorage.getItem(KEY)); return Number.isFinite(at) && at > 0 && Date.now() - at < WEEK; } catch { return false; }
}

export default function ResoluteBar() {
  const [lang] = useResearchLanguage();
  const ja = lang === "ja";
  const [eligible, setEligible] = useState(false);
  // The seven-day mark is read once at start (the bar renders nothing until the entitlement answer arrives, so no flash).
  // `?resoluteBar=reset` forgets it (for checking the preview); it never overrides a purchase.
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("resoluteBar") === "reset") {
        localStorage.removeItem(KEY);
        url.searchParams.delete("resoluteBar");
        window.history.replaceState(null, "", url.pathname + url.search + url.hash);
      }
    } catch { /* storage may be blocked */ }
    return dismissedRecently();
  });

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/resolute/entitlements", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        if (controller.signal.aborted) return;
        if (response.status === 401) { setEligible(true); return; }
        if (!response.ok) return;
        const body = await response.json();
        if (body && typeof body.canUseTools === "boolean") setEligible(body.canUseTools === false);
      } catch { /* unknown stays hidden */ }
    })();
    return () => controller.abort();
  }, []);

  const shown = eligible && !dismissed;
  useEffect(() => {
    // The "↑ 先頭へ" button moves up by the bar's height while the bar is on screen.
    if (shown) document.documentElement.dataset.resoluteBar = "on"; else delete document.documentElement.dataset.resoluteBar;
    return () => { delete document.documentElement.dataset.resoluteBar; };
  }, [shown]);

  if (!shown) return null;
  return <aside className={styles.bar} aria-label="RESOLUTE">
    <span className={styles.emblem} aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2" /><path d="M12 7v14M7 11h10M5 15c0 3 3 5 7 5s7-2 7-5" /></svg></span>
    <span className={styles.text}><b>RESOLUTE</b><small>{ja ? "暴落の日のルールを作る" : "Make your crash-day rules"}</small></span>
    <Link href="/resolute" className={styles.open}>{ja ? "開く" : "Open"}</Link>
    <button type="button" className={styles.close} aria-label={ja ? "RESOLUTEの案内を閉じる（7日間表示しません）" : "Dismiss (hidden for 7 days)"} onClick={() => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* storage may be blocked */ } setDismissed(true); }}>×</button>
  </aside>;
}
