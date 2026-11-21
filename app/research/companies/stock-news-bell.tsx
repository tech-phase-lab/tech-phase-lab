"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { providers } from "@/lib/research/intake";
import { bellOn, bellPatch, type BellState, type NewsChoice } from "@/lib/research/stock-news-bell";
import { useIdentityRefresh } from "../identity-provider";
import styles from "./company-activity.module.css";

const monitored = providers.map(p => p.ticker);
const bellIcon = <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 22a2.3 2.3 0 0 0 2.3-2.3H9.7A2.3 2.3 0 0 0 12 22zm6.6-6.4V11a6.6 6.6 0 0 0-5.1-6.4V3.9a1.5 1.5 0 0 0-3 0v.7A6.6 6.6 0 0 0 5.4 11v4.6L3.6 17.4V19h16.8v-1.6z"/></svg>;

async function subscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("unsupported");
  const registration = await navigator.serviceWorker.getRegistration("/research");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** 「この銘柄の速報を通知する」 (PRO; Nov 21): the same per-device setting as 監視株ニュース on the notification page, for this stock. */
export default function StockNewsBell({ ticker, ja, full }: { ticker: string; ja: boolean; full: boolean }) {
  const refreshIdentity = useIdentityRefresh();
  const identity = useRef(refreshIdentity);
  useEffect(() => { identity.current = refreshIdentity; }, [refreshIdentity]);
  const [state, setState] = useState<BellState>(full ? "checking" : "free");
  const [choice, setChoice] = useState<NewsChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);
  const t = (a: string, b: string) => ja ? a : b;

  async function ask(body: Record<string, unknown>): Promise<{ status: number; result: Record<string, unknown> | null }> {
    const send = () => fetch("/api/research/notifications", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    try { await identity.current(); } catch { /* identity still loading: the server decides */ }
    let response = await send();
    if (response.status === 401) { try { await identity.current(true); response = await send(); } catch { /* keep the first answer */ } }
    return { status: response.status, result: await response.json().catch(() => null) };
  }

  useEffect(() => {
    if (!full) { setState("free"); return; }
    let live = true;
    setState("checking");
    (async () => {
      try {
        const sub = await subscription();
        if (!live) return;
        if (!sub) { setState("no-device"); return; }
        const { status, result } = await ask({ action: "preferences", subscription: sub.toJSON() });
        if (!live) return;
        const prefs = result?.ok === true ? result.preferences as NewsChoice | undefined : undefined;
        if (prefs && Array.isArray(prefs.newsTickers)) { setChoice({ news: prefs.news === true, newsTickers: prefs.newsTickers }); setState(bellOn(prefs, ticker) ? "on" : "off"); return; }
        setState(status === 403 ? "free" : ["not-owned", "not-registered", "subscription-mismatch"].includes(String(result?.error)) ? "no-device" : "error");
      } catch (error) {
        if (live) setState((error as Error)?.message === "unsupported" ? "unsupported" : "error");
      }
    })();
    return () => { live = false; };
  }, [full, ticker, round]);

  async function toggle() {
    if (!choice || busy) return;
    const patch = bellPatch(choice, ticker, monitored);
    if (!patch) return;
    setBusy(true);
    try {
      const sub = await subscription();
      if (!sub) { setState("no-device"); return; }
      const { result } = await ask({ action: "save-preferences", subscription: sub.toJSON(), preferences: patch });
      const prefs = result?.ok === true ? result.preferences as NewsChoice | undefined : undefined;
      if (!prefs || !Array.isArray(prefs.newsTickers)) throw new Error("save");
      const next = { news: prefs.news === true, newsTickers: prefs.newsTickers };
      setChoice(next); setState(bellOn(next, ticker) ? "on" : "off");
    } catch { setState("error"); }
    finally { setBusy(false); }
  }

  if (!monitored.includes(ticker)) return null;
  const label = t("この銘柄の速報を通知する", "Notify me about this stock");
  if (state === "free") return <Link href="/research#tech-phase-pro" className={styles.bell} aria-label={t(`${label}(PRO)`, `${label} (PRO)`)}>{bellIcon}{label}<small>PRO</small></Link>;
  if (state === "no-device") return <Link href="/research/notifications" className={styles.bell} aria-label={t(`${label}：先にこの端末の通知をオンにしてください`, `${label}: turn on notifications on this device first`)}>{bellIcon}{label}<small>{t("通知をオンに", "Turn on")}</small></Link>;
  if (state === "unsupported") return <span className={styles.bell} aria-disabled="true">{bellIcon}{t("この端末では通知を受け取れません", "This device can't receive notifications")}</span>;
  if (state === "error") return <button type="button" className={styles.bell} onClick={() => setRound(value => value + 1)}>{bellIcon}{t("通知の設定を確認できませんでした（再試行）", "Couldn't check the setting (retry)")}</button>;
  const on = state === "on";
  return <button type="button" className={`${styles.bell} ${on ? styles.bellOn : ""}`} role="switch" aria-checked={on} aria-busy={busy || state === "checking"} disabled={busy || state === "checking"} onClick={toggle}
    aria-label={label}>{bellIcon}{state === "checking" ? t("通知の設定を確認中…", "Checking…") : on ? t("この銘柄の速報を通知中", "Notifying you about this stock") : label}<small>{on ? "ON" : "PRO"}</small></button>;
}
