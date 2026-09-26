"use client";
import { useEffect, useState } from "react";
import type { Language } from "@/lib/research/data";
import styles from "./price-targets-panel.module.css";

export default function NotificationSettings({ lang }: { lang: Language }) {
  const [config, setConfig] = useState<{ enabled: boolean; publicKey?: string; tickers?: string[] } | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/research/notifications", { signal: controller.signal }).then(r => r.json()).then(setConfig).catch(() => {});
    return () => controller.abort();
  }, []);
  async function save(remove = false) {
    setBusy(true); setMessage("");
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        throw new Error(t("このブラウザーでは通知を設定できません。iPhoneはSafariでホーム画面に追加し、そのアイコンから開いてください。", "Notifications are unavailable in this browser. On iPhone, add the site to your Home Screen in Safari and open its icon."));
      }
      if (!remove && !config?.publicKey) throw new Error(t("通知設定を読み込めませんでした。", "Notification settings are unavailable."));
      const registration = await navigator.serviceWorker.register("/research-sw.js", { scope: "/research", updateViaCache: "none" });
      // navigator.serviceWorker.ready also waits for first installation to activate.
      await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!remove && !subscription) {
        const raw = atob(config!.publicKey!.replace(/-/g, "+").replace(/_/g, "/"));
        subscription = await registration.pushManager.subscribe({ userVisibleOnly: true,
          applicationServerKey: Uint8Array.from(raw, c => c.charCodeAt(0)) });
      }
      if (!subscription) { setMessage(t("この端末の通知は停止しています。", "Notifications are off on this device.")); return; }
      const response = await fetch("/api/research/notifications", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: remove ? "remove" : "register", subscription: subscription.toJSON(),
          allTargets: true, language: lang, code }) });
      if (!response.ok) throw new Error(t("保存できませんでした。試験コードと接続を確認してください。", "Could not save. Check the pilot code and connection."));
      if (remove) await subscription.unsubscribe();
      setCode("");
      setMessage(remove ? t("この端末の通知を停止しました。", "Notifications stopped on this device.") : t("保存しました。取得した新しい目標株価変更を通知します。", "Saved. New price target changes will be sent."));
    } catch (error) { setMessage(error instanceof Error ? error.message : t("設定できませんでした。", "Setup failed.")); }
    finally { setBusy(false); }
  }
  return <>
    <button type="button" className={styles.notificationToggle} aria-expanded={open} aria-controls={open ? "price-target-notifications" : undefined} onClick={() => setOpen(!open)}>
      {t("通知設定", "Alerts")} <span aria-hidden="true">{open ? "−" : "+"}</span>
    </button>
    {open && <div id="price-target-notifications" className={styles.notificationBody}>
    {config === null ? <p>{t("通知の設定を確認中…", "Checking notification settings…")}</p> : !config.enabled ? <p>{t("端末への通知は準備中です。まだ通知は送信されません。", "Device notifications are being prepared. No notifications are sent yet.")}</p> : <>
      <strong className={styles.notificationTitle}>{t("目標株価の通知を受け取る", "Receive price target alerts")}</strong>
      <p>{t("目標株価の引き上げ・引き下げをスマホに通知します。", "Get price target increases and decreases on your phone.")}</p>
      <label className={styles.codeLabel} htmlFor="price-target-pilot-code">{t("確認用コード（テスト参加者のみ）", "Access code (test participants)")}</label>
      <input id="price-target-pilot-code" className={styles.codeInput} type="password" autoComplete="off" value={code} onChange={e => setCode(e.target.value)} />
      <div className={styles.notificationActions}>
        <button type="button" disabled={busy || !code} onClick={() => void save()}>{t("通知をオン", "Turn on")}</button>
        <button type="button" disabled={busy || !code} onClick={() => void save(true)}>{t("通知をオフ", "Turn off")}</button>
      </div>
      <p className={styles.pilotNote}>{t("コードを入力し、オン／オフを選んでください。", "Enter your code, then choose on or off.")}</p>
    </>}
    {message && <p role="status">{message}</p>}
    </div>}
  </>;
}
