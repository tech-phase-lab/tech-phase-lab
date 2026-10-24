"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { waitForIdentity } from "@/lib/research/member-recovery";
import type { Language } from "@/lib/research/data";
import styles from "./price-targets-panel.module.css";

type State = "checking" | "off" | "on" | "unknown" | "blocked" | "unsupported" | "unavailable" | "sign-in" | "pro-required";
export default function NotificationSettings({ lang, initiallyOpen = false }: { lang: Language; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [state, setState] = useState<State>("checking");
  const [hasSubscription, setHasSubscription] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [testSent, setTestSent] = useState(false);
  const [received, setReceived] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const inspection = useRef(0);
  const operation = useRef(false);
  const pendingInspection = useRef(false);
  const [refresh, setRefresh] = useState(0);
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let requestController: AbortController | undefined;
    let resumeTimer: ReturnType<typeof setTimeout> | undefined;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    async function inspect() {
      if (operation.current) { pendingInspection.current = true; return; }
      pendingInspection.current = false;
      const current = ++inspection.current;
      requestController?.abort();
      requestController = new AbortController();
      const signal = AbortSignal.any([requestController.signal, AbortSignal.timeout(15_000)]);
      const active = () => !cancelled && current === inspection.current && !signal.aborted;
      clearTimeout(expiryTimer);
      setState("checking"); setKey(""); setTestSent(false); setReceived(false); setMessage("");
      try {
        const response = await fetch("/api/research/notifications", { cache: "no-store", signal });
        const config = await response.json();
        if (!active()) return;
        // Resolve membership before device guidance so signed-out and Free users
        // are not asked to change permissions for a feature they cannot use yet.
        const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
        const registration = supported ? await waitForIdentity(navigator.serviceWorker.getRegistration("/research"), signal) : undefined;
        const subscription = registration ? await waitForIdentity(registration.pushManager.getSubscription(), signal) : undefined;
        if (!active()) return;
        setHasSubscription(Boolean(subscription));
        if (config.reason === "sign-in" || config.reason === "pro-required") { setState(config.reason); return; }
        if (!response.ok || !config.enabled || !config.publicKey) { setState("unavailable"); return; }
        if (!Number.isFinite(config.validUntil) || config.validUntil <= Date.now()) { setState("pro-required"); return; }
        // A capped browser timer is a recheck, not proof that paid access expired.
        expiryTimer = setTimeout(() => { void inspect(); }, Math.min(config.validUntil - Date.now(), 2_147_483_647));
        if (!supported) { setState("unsupported"); return; }
        if (Notification.permission === "denied") { setState("blocked"); return; }
        setKey(config.publicKey);
        if (subscription) {
          const check = await fetch("/api/research/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "status", subscription: subscription.toJSON() }), signal });
          const result = await check.json();
          if (active()) setState(check.status === 401 ? "sign-in" : check.status === 403 ? "pro-required" : check.ok && result.ok ? result.registered ? "on" : "off" : "unknown");
        } else if (active()) setState("off");
      } catch { if (!cancelled && current === inspection.current) setState("unavailable"); }
    }
    const visible = () => { if (document.visibilityState === "visible") { clearTimeout(resumeTimer); resumeTimer = setTimeout(() => { void inspect(); }, 0); } };
    void inspect();
    window.addEventListener("focus", visible);
    window.addEventListener("pageshow", visible);
    window.addEventListener("online", visible);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("tech-phase:membership-changed", inspect);
    return () => { cancelled = true; requestController?.abort(); clearTimeout(expiryTimer); clearTimeout(resumeTimer); window.removeEventListener("focus", visible); window.removeEventListener("pageshow", visible); window.removeEventListener("online", visible); document.removeEventListener("visibilitychange", visible); window.removeEventListener("tech-phase:membership-changed", inspect); };
  }, [open, refresh]);
  async function request(action: string, subscription: PushSubscription) {
    const response = await fetch("/api/research/notifications", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, subscription: subscription.toJSON(), allTargets: true, language: lang }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401 || response.status === 403) { setState(response.status === 401 ? "sign-in" : "pro-required"); throw new Error(t("ログインとPRO会員の有効期限を確認してください。", "Check your sign-in and PRO membership.")); }
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(t("接続できませんでした。もう一度お試しください。", "Unable to connect. Please try again."));
    return result;
  }
  async function run(action: "enable" | "disable" | "status" | "test") {
    if (operation.current) return;
    operation.current = true;
    inspection.current++; // An older inspection must not overwrite this device action.
    setBusy(true); setMessage("");
    try {
      if (action === "enable") {
        if (Notification.permission !== "granted") {
          const permission = await Notification.requestPermission();
          if (permission !== "granted") { setState(permission === "denied" ? "blocked" : "off"); return; }
        }
      }
      const registration = await navigator.serviceWorker.register("/research-sw.js", { scope: "/" });
      // Wait for installation without relying on an indefinitely pending ready promise.
      if (!registration.active) await new Promise<void>((resolve, reject) => {
        const worker = registration.installing || registration.waiting;
        if (!worker) { reject(new Error("Service worker unavailable")); return; }
        const timeout = setTimeout(() => { worker.removeEventListener("statechange", changed); reject(new Error("Service worker timeout")); }, 10_000);
        function changed() { if (worker?.state === "activated") { clearTimeout(timeout); worker.removeEventListener("statechange", changed); resolve(); } }
        worker.addEventListener("statechange", changed); changed();
      });
      let subscription = await registration.pushManager.getSubscription();
      if (action === "disable") {
        // A successful browser unsubscribe stops this device even if the server is unavailable.
        if (subscription) {
          if (!await subscription.unsubscribe()) throw new Error(t("停止できませんでした。", "Could not stop notifications."));
          try { await request("remove", subscription); } catch { /* Browser endpoint has already been revoked. */ }
        }
        setHasSubscription(false); setState("off"); setTestSent(false); setReceived(false); return;
      }
      if (action === "enable") {
        const bytes = Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
        subscription = subscription || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
        setHasSubscription(true);
        const result = await request("register", subscription);
        setState(result.registered ? "on" : "unknown"); setReceived(false); setTestSent(false);
      } else if (!subscription) { setState("off"); }
      else if (action === "status") {
        const result = await request("status", subscription); setState(result.registered ? "on" : "off");
      } else {
        if (Date.now() < retryAt) throw new Error(t("次のテストは1分後に送れます。", "Wait one minute before testing again."));
        setReceived(false); setTestSent(false); setRetryAt(Date.now() + 60_000);
        const result = await request("test", subscription);
        if (result.expired) { setState("off"); await subscription.unsubscribe(); }
        setTestSent(result.accepted === true);
        const failure = result.retryAfter ? t("次のテストは1分後に送れます。", "Wait one minute before testing again.")
          : result.expired ? t("端末の通知登録が期限切れです。通知をオンにし直してください。", "This device subscription expired. Turn notifications on again.")
          : result.providerStatus === 401 || result.providerStatus === 403 ? t("通知サービスの送信認証で失敗しました。管理者が設定を確認します。", "Push service authentication failed. The administrator needs to check the configuration.")
          : result.providerStatus === 429 ? t("通知サービスが送信を制限しています。時間をおいて再試行してください。", "The push service is limiting requests. Try again later.")
          : result.providerStatus === 0 ? t("通知送信処理でエラーが発生しました。管理者がログを確認します。", "The push sender encountered an error. The administrator needs to inspect the logs.")
          : t("通知サービスに受け付けられませんでした。1分後に再試行できます。", "The push service did not accept the message. You can retry in one minute.");
        setMessage(result.accepted ? t("送信を受け付けました。スマホに届いたら「届きました」を押してください。", "Send accepted. Select Received after it appears on your phone.") : failure);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : t("接続を確認してください。", "Check your connection.")); if (action === "enable") setState(current => current === "sign-in" || current === "pro-required" ? current : "unknown"); }
    finally { operation.current = false; setBusy(false); if (pendingInspection.current) setRefresh(value => value + 1); }
  }
  const label = { "sign-in": t("通知を利用するにはログインしてください", "Sign in to use notifications"), "pro-required": t("スマホ通知はPRO会員向けです", "Phone notifications are available with PRO"), checking: t("確認中…", "Checking…"), off: t("この端末：通知オフ", "This device: off"), on: t("この端末：通知オン", "This device: on"), unknown: t("この端末：登録状態を確認", "This device: verify registration"), blocked: t("この端末：通知が許可されていません", "This device: permission blocked"), unsupported: t("このブラウザでは通知を利用できません", "Notifications unavailable in this browser"), unavailable: t("通知サービスに接続できません", "Notification service unavailable") }[state];
  const usable = ["off", "on", "unknown"].includes(state);
  return <>
    <button type="button" className={styles.notificationToggle} aria-expanded={open} aria-controls={open ? "price-target-notifications" : undefined} onClick={() => setOpen(!open)}><svg className={styles.bellIcon} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 22a2.3 2.3 0 0 0 2.3-2.3H9.7A2.3 2.3 0 0 0 12 22zm6.6-6.4V11a6.6 6.6 0 0 0-5.1-6.4V3.9a1.5 1.5 0 0 0-3 0v.7A6.6 6.6 0 0 0 5.4 11v4.6L3.6 17.4V19h16.8v-1.6z"/></svg>{t("スマホ通知設定", "Phone notifications")}</button>
    {open && <div id="price-target-notifications" className={styles.notificationBody}>
      <strong className={styles.notificationTitle}>{t("目標株価・決算速報のスマホ通知", "Price target and earnings phone alerts")}</strong>
      <p role="status">{label}</p>
      {(state === "unavailable" || state === "checking") && <button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>{t("再確認", "Try again")}</button>}
      {(state === "sign-in" || state === "pro-required") && <Link href="/research/account">{t("ログイン・会員情報", "Sign in / Membership")}</Link>}
      {!usable && hasSubscription && <button type="button" disabled={busy} onClick={() => void run("disable")}>{t("この端末の通知をオフ", "Turn off on this device")}</button>}
      {state === "unsupported" && <p>{t("iPhoneではSafariの共有メニューからホーム画面に追加し、そのアイコンから開いてください。", "On iPhone, add this site to your Home Screen using Safari’s Share menu, then open that icon.")}</p>}
      {state === "blocked" && <p>{t("端末またはブラウザの設定で、Tech Phaseの通知を許可してください。", "Allow Tech Phase notifications in your device or browser settings.")}</p>}
      {usable && <>
        <div className={styles.notificationActions}>
          <button type="button" disabled={busy} onClick={() => void run(state === "on" ? "disable" : "enable")}>{state === "on" ? t("この端末の通知をオフ", "Turn off on this device") : t("通知をオンにする", "Turn on notifications")}</button>
          {state === "unknown" && <><button type="button" disabled={busy} onClick={() => void run("status")}>{t("登録状態を確認", "Check registration")}</button><button type="button" disabled={busy} onClick={() => void run("disable")}>{t("この端末の通知をオフ", "Turn off on this device")}</button></>}
          {state === "on" && <button type="button" disabled={busy} onClick={() => void run("test")}>{t("テスト通知を送る", "Send test notification")}</button>}
        </div>
      </>}
      {busy && <p role="status">{t("処理中…", "Working…")}</p>}
      {message && <p role="status">{message}</p>}
      {testSent && !received && <button type="button" onClick={() => { setReceived(true); setMessage(""); }}>{t("届きました", "Received")}</button>}
      {received && <p role="status">{t("この端末で受信を確認しました。", "Receipt confirmed on this device.")}</p>}
    </div>}
  </>;
}
