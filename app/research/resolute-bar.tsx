"use client";
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useResearchLanguage } from "./use-research-language";
import { useMemberDisplay } from "./member-display-provider";
import { BAR_DISMISS_KEY, BAR_EVENT, BAR_STATE_KEY, barVisible, needsRefresh, parseBarState, writeBarState } from "@/lib/research/resolute-bar-state";
import styles from "./resolute-bar.module.css";

/** RESOLUTE's standing bar (owner, Oct 26): home screen, phones only, floating 8px above the bottom menu.
 * Drawn from what the device remembers, so it is there as soon as the app opens; the purchase answer is refreshed in the
 * background (never awaited), and a purchaser is never shown the bar. "×" hides it for seven days. */
function subscribe(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(BAR_EVENT, notify);
  return () => { window.removeEventListener("storage", notify); window.removeEventListener(BAR_EVENT, notify); };
}
const snapshot = () => { try { return `${localStorage.getItem(BAR_STATE_KEY) ?? ""}|${localStorage.getItem(BAR_DISMISS_KEY) ?? ""}`; } catch { return "|"; } };
const serverSnapshot = () => "|";

export default function ResoluteBar() {
  const [lang] = useResearchLanguage();
  const ja = lang === "ja";
  const plan = useMemberDisplay();
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [stateRaw, dismissRaw] = raw.split("|");
  const state = parseBarState(stateRaw || null);
  const dismissedAt = Number(dismissRaw) || 0;
  const [openedAt] = useState(() => Date.now());
  const shown = barVisible(state, dismissedAt, plan !== null, openedAt);
  const [lift, setLift] = useState<number | null>(null);

  // Background refresh: never blocks the bar. A fresh enough answer is left alone.
  const planKnown = plan !== null;
  useEffect(() => {
    if (!needsRefresh(parseBarState(localStorage.getItem(BAR_STATE_KEY)), planKnown, Date.now())) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/resolute/entitlements", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        if (controller.signal.aborted) return;
        if (response.status === 401) { writeBarState({ owned: false, anon: true }); return; }
        if (!response.ok) return;
        const body = await response.json();
        if (body && typeof body.canUseTools === "boolean") writeBarState({ owned: body.canUseTools, anon: false });
      } catch { /* unknown keeps what is remembered */ }
    })();
    return () => controller.abort();
  // Runs again when the member check answers: a signed-out answer remembered from before must be refreshed then.
  }, [planKnown]);

  // `?resoluteBar=reset` forgets the seven-day mark (for checking the preview); it never overrides a purchase.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("resoluteBar") !== "reset") return;
      localStorage.removeItem(BAR_DISMISS_KEY);
      url.searchParams.delete("resoluteBar");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
      window.dispatchEvent(new Event(BAR_EVENT));
    } catch { /* storage may be blocked */ }
  }, []);

  // Float 8px above the bottom menu wherever that menu really is (with or without the home-indicator gap).
  useLayoutEffect(() => {
    if (!shown) return;
    const place = () => {
      const menu = document.querySelector<HTMLElement>("[data-tab]")?.parentElement;
      if (menu) setLift(Math.round(window.innerHeight - menu.getBoundingClientRect().top + 8));
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [shown]);

  useEffect(() => {
    // The "↑ 先頭へ" button moves up by the bar's height while the bar is on screen.
    if (shown) document.documentElement.dataset.resoluteBar = "on"; else delete document.documentElement.dataset.resoluteBar;
    return () => { delete document.documentElement.dataset.resoluteBar; };
  }, [shown]);

  if (!shown) return null;
  return <aside className={styles.bar} style={lift === null ? undefined : { bottom: lift }} aria-label="RESOLUTE">
    <span className={styles.emblem} aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2" /><path d="M12 7v14M7 11h10M5 15c0 3 3 5 7 5s7-2 7-5" /></svg></span>
    <span className={styles.text}><b>RESOLUTE</b><small>{ja ? "暴落の夜も、迷わない" : "Steady on the night of a crash"}</small></span>
    <Link href="/resolute" className={styles.open}>{ja ? "開く" : "Open"}</Link>
    <button type="button" className={styles.close} aria-label={ja ? "RESOLUTEの案内を閉じる（7日間表示しません）" : "Dismiss (hidden for 7 days)"} onClick={() => { try { localStorage.setItem(BAR_DISMISS_KEY, String(Date.now())); window.dispatchEvent(new Event(BAR_EVENT)); } catch { /* storage may be blocked */ } }}><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" /></svg></button>
  </aside>;
}
