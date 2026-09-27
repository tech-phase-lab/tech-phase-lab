"use client";
import { useEffect, useState } from "react";
import type { Language } from "@/lib/research/data";
import styles from "./price-targets-panel.module.css";

type State = "checking" | "off" | "on" | "unknown" | "blocked" | "unsupported" | "unavailable";
export default function NotificationSettings({ lang, initiallyOpen = false }: { lang: Language; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [state, setState] = useState<State>("checking");
  const [key, setKey] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [testSent, setTestSent] = useState(false);
  const [received, setReceived] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function inspect() {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState("unsupported"); return;
      }
      if (Notification.permission === "denied") { setState("blocked"); return; }
      try {
        const response = await fetch("/api/research/notifications", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
        const config = await response.json();
        if (cancelled) return;
        if (!config.enabled || !config.publicKey) { setState("unavailable"); return; }
        setKey(config.publicKey);
        const registration = await navigator.serviceWorker.getRegistration("/research");
        const subscription = await registration?.pushManager.getSubscription();
        if (!cancelled) setState(subscription ? "unknown" : "off");
      } catch { if (!cancelled) setState("unavailable"); }
    }
    void inspect();
    return () => { cancelled = true; };
  }, [open]);
  async function request(action: string, subscription: PushSubscription) {
    const response = await fetch("/api/research/notifications", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, code, subscription: subscription.toJSON(), allTargets: true, language: lang }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 403) throw new Error(t("接続コードを確認してください。", "Check your access code."));
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(t("接続できませんでした。もう一度お試しください。", "Unable to connect. Please try again."));
    return result;
  }
  async function run(action: "enable" | "disable" | "status" | "test") {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      if (action !== "disable" && !code) throw new Error(t("下の運営者用接続にコードを入力してください。", "Enter the private preview access code below."));
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
          if (code) { try { await request("remove", subscription); } catch { /* Expired endpoint is removed on the next delivery. */ } }
        }
        setState("off"); setTestSent(false); setReceived(false); return;
      }
      if (!code) throw new Error(t("初回接続には下の運営者用接続コードが必要です。", "Enter the private preview access code below."));
      if (action === "enable") {
        const bytes = Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
        subscription = subscription || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
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
        setMessage(result.accepted ? t("送信を受け付けました。スマホに届いたら「届きました」を押してください。", "Send accepted. Select Received after it appears on your phone.") : t("受信を確認できません。1分後に再試行できます。", "Delivery is unconfirmed. You can retry in one minute."));
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : t("接続を確認してください。", "Check your connection.")); if (action === "enable") setState("unknown"); }
    finally { setBusy(false); }
  }
  const label = { checking: t("確認中…", "Checking…"), off: t("この端末：通知オフ", "This device: off"), on: t("この端末：通知オン", "This device: on"), unknown: t("この端末：登録状態を確認", "This device: verify registration"), blocked: t("この端末：通知が許可されていません", "This device: permission blocked"), unsupported: t("このブラウザでは通知を利用できません", "Notifications unavailable in this browser"), unavailable: t("通知サービスに接続できません", "Notification service unavailable") }[state];
  const usable = ["off", "on", "unknown"].includes(state);
  return <>
    <button type="button" className={styles.notificationToggle} aria-expanded={open} aria-controls={open ? "price-target-notifications" : undefined} onClick={() => setOpen(!open)}>{t("スマホ通知設定", "Phone notifications")}</button>
    {open && <div id="price-target-notifications" className={styles.notificationBody}>
      <strong className={styles.notificationTitle}>{t("目標株価のスマホ通知", "Price target phone alerts")}</strong>
      <p role="status">{label}</p>
      {state === "unsupported" && <p>{t("iPhoneではSafariの共有メニューからホーム画面に追加し、そのアイコンから開いてください。", "On iPhone, add this site to your Home Screen using Safari’s Share menu, then open that icon.")}</p>}
      {state === "blocked" && <p>{t("端末またはブラウザの設定で、Tech Phaseの通知を許可してください。", "Allow Tech Phase notifications in your device or browser settings.")}</p>}
      {usable && <>
        <div className={styles.notificationActions}>
          <button type="button" disabled={busy} onClick={() => void run(state === "on" ? "disable" : "enable")}>{state === "on" ? t("この端末の通知をオフ", "Turn off on this device") : t("通知をオンにする", "Turn on notifications")}</button>
          {state === "unknown" && <><button type="button" disabled={busy} onClick={() => void run("status")}>{t("登録状態を確認", "Check registration")}</button><button type="button" disabled={busy} onClick={() => void run("disable")}>{t("この端末の通知をオフ", "Turn off on this device")}</button></>}
          {state === "on" && <button type="button" disabled={busy} onClick={() => void run("test")}>{t("テスト通知を送る", "Send test notification")}</button>}
        </div>
        <details><summary>{t("運営者用の接続", "Private preview access")}</summary><label className={styles.codeLabel}>{t("接続コード", "Access code")}<input className={styles.codeInput} type="password" autoComplete="off" value={code} onChange={e => setCode(e.target.value)} /></label><p>{t("公開前の接続確認用です。コードは保存されません。", "For pre-launch testing. The code is not saved.")}</p></details>
      </>}
      {busy && <p role="status">{t("処理中…", "Working…")}</p>}
      {message && <p role="status">{message}</p>}
      {testSent && !received && <button type="button" onClick={() => { setReceived(true); setMessage(""); }}>{t("届きました", "Received")}</button>}
      {received && <p role="status">{t("この端末で受信を確認しました。", "Receipt confirmed on this device.")}</p>}
    </div>}
  </>;
}
