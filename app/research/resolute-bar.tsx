"use client";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useOwnerAccount } from "./member-display-provider";
import { useResearchLanguage } from "./use-research-language";
import { signedInFromCookies } from "@/lib/resolute/landing-gate";
import { BAR_DISMISS_KEY, BAR_EVENT, BAR_STATE_KEY, barStateFromAnswer, barVisible, needsRefresh, parseBarState, writeBarState } from "@/lib/research/resolute-bar-state";
import styles from "./resolute-bar.module.css";

/** RESOLUTE's standing bar (owner, Oct 26): home screen, phones only, attached 8px above the bottom menu (drawn inside its dock).
 * Drawn from what the device remembers, so it is there as soon as the app opens; the purchase answer is refreshed in the
 * background (never awaited), and a purchaser is never shown the bar. "×" hides it for seven days. */
function subscribe(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(BAR_EVENT, notify);
  return () => { window.removeEventListener("storage", notify); window.removeEventListener(BAR_EVENT, notify); };
}
const snapshot = () => { try { return `${localStorage.getItem(BAR_STATE_KEY) ?? ""}|${localStorage.getItem(BAR_DISMISS_KEY) ?? ""}|${signedInFromCookies(document.cookie) ? "1" : "0"}`; } catch { return "||"; } };
const serverSnapshot = () => "||";

export default function ResoluteBar() {
  const [lang] = useResearchLanguage();
  const ownerAccount = useOwnerAccount();
  const ja = lang === "ja";
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [stateRaw, dismissRaw, signedRaw] = raw.split("|");
  const signedIn = signedRaw === "1";
  const state = parseBarState(stateRaw || null);
  const dismissedAt = Number(dismissRaw) || 0;
  const [openedAt] = useState(() => Date.now());
  const shown = barVisible(state, dismissedAt, signedIn, openedAt, ownerAccount);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [notch, setNotch] = useState<{ x: number; y: number; r: number } | null>(null);
  const bar = useRef<HTMLElement>(null);

  // Background refresh: never blocks the bar. A fresh enough answer is left alone.
  useEffect(() => {
    if (!needsRefresh(parseBarState(localStorage.getItem(BAR_STATE_KEY)), signedIn, Date.now())) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/resolute/entitlements", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        if (controller.signal.aborted) return;
        if (response.status === 401) { writeBarState({ owned: false, anon: true }); return; }
        if (!response.ok) return;
        const body = await response.json();
        const answer = barStateFromAnswer(body);
        if (answer) writeBarState(answer);
      } catch { /* unknown keeps what is remembered */ }
    })();
    return () => controller.abort();
  // Asked at once on opening (not after the member check), and again if the sign-in state changes.
  }, [signedIn]);

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

  // The bar is drawn inside the bottom menu's fixed dock (its RESOLUTE slot), so CSS alone keeps it 8px above the menu: the
  // earlier separate fixed bar was lifted by measuring the menu, and in iPhone Safari the toolbar sliding in and out moved the
  // menu before the measurement caught up, leaving the bar floating apart or over the menu (owner, Nov 17).
  useLayoutEffect(() => {
    if (!shown) return;
    const find = () => setHost(current => {
      const slot = document.querySelector<HTMLElement>("[data-resolute-slot]");
      return current?.isConnected && current === slot ? current : slot;
    });
    find();
    window.addEventListener("pageshow", find);
    return () => window.removeEventListener("pageshow", find);
  }, [shown]);

  // The round notch is cut around the Search button where it really is (in a browser tab the menu is docked differently and the
  // button is raised less). Bar and button sit in the same fixed dock, so their distance only changes when the dock's size does.
  useLayoutEffect(() => {
    if (!shown || !host) return;
    const place = () => {
      const orb = document.querySelector<HTMLElement>("[data-tab] [data-orb]")?.getBoundingClientRect(), self = bar.current;
      if (!orb || !self) return;
      const own = self.getBoundingClientRect();
      setNotch({ x: Math.round((orb.left + orb.width / 2 - own.left) * 10) / 10, y: Math.round((orb.top + orb.height / 2 - own.top) * 10) / 10, r: Math.round(orb.width / 2 + 7) });
    };
    place();
    // Fonts and the menu's own layout can settle after the first paint.
    const timers = [60, 250, 700, 1500, 3000].map(ms => window.setTimeout(place, ms));
    const menu = document.querySelector<HTMLElement>("[data-bottom-nav]");
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    if (menu) observer?.observe(menu);
    if (bar.current) observer?.observe(bar.current);
    window.addEventListener("resize", place);
    window.addEventListener("pageshow", place);
    return () => {
      timers.forEach(window.clearTimeout); observer?.disconnect();
      window.removeEventListener("resize", place); window.removeEventListener("pageshow", place);
    };
  }, [shown, host]);

  useEffect(() => {
    // The "↑ 先頭へ" button moves up by the bar's height while the bar is on screen.
    if (shown) document.documentElement.dataset.resoluteBar = "on"; else delete document.documentElement.dataset.resoluteBar;
    return () => { delete document.documentElement.dataset.resoluteBar; };
  }, [shown]);

  if (!shown || !host) return null;
  const style = { ...(notch ? { "--notch-x": `${notch.x}px`, "--notch-y": `${notch.y}px`, "--notch-r": `${notch.r}px` } : {}) } as CSSProperties;
  return createPortal(<aside ref={bar} className={styles.bar} style={style} aria-label="RESOLUTE">
    <span className={styles.emblem} aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2" /><path d="M12 7v14M7 11h10M5 15c0 3 3 5 7 5s7-2 7-5" /></svg></span>
    <span className={styles.text}><b>RESOLUTE</b><small>{ja ? "暴落の夜も、迷わない" : "Stay grounded when markets tumble."}</small></span>
    <Link href={ja ? "/resolute" : "/resolute?lang=en"} className={styles.open}>{ja ? "開く" : "Open"}</Link>
    <button type="button" className={styles.close} aria-label={ja ? "RESOLUTEの案内を閉じる（7日間表示しません）" : "Dismiss (hidden for 7 days)"} onClick={() => { try { localStorage.setItem(BAR_DISMISS_KEY, String(Date.now())); window.dispatchEvent(new Event(BAR_EVENT)); } catch { /* storage may be blocked */ } }}><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" /></svg></button>
  </aside>, host);
}
