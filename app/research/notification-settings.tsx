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
      {open ? t("通知設定を閉じる", "Close notification settings") : t("スマホ通知を設定", "Set up phone alerts")}
    </button>
    {open && <div id="price-target-notifications" className={styles.notificationBody}>
    {config === null ? <p>{t("通知の設定を確認中…", "Checking notification settings…")}</p> : !config.enabled ? <p>{t("端末への通知は準備中です。まだ通知は送信されません。", "Device notifications are being prepared. No notifications are sent yet.")}</p> : <>
      <strong className={styles.notificationTitle}>{t("目標株価の通知を受け取る", "Receive price target alerts")}</strong>
      <p>{t("監視中の3つの情報源から、新しい目標株価の引き上げ・引き下げを通知します。銘柄の選択は不要です。", "Receive new price target increases and decreases from the three monitored sources. No ticker selection is needed.")}</p>
      <p className={styles.pilotNote}>{t("現在は試験運用中です。運営から案内された試験用コードを入力してください。正式公開時の会員向け設定は別途整備します。", "This is a private pilot. Enter the code provided by the team. Member notification settings will be prepared for launch.")}</p>
      <label className={styles.codeLabel} htmlFor="price-target-pilot-code">{t("試験用コード", "Pilot code")}</label>
      <input id="price-target-pilot-code" className={styles.codeInput} type="password" autoComplete="off" value={code} onChange={e => setCode(e.target.value)} />
      <div className={styles.notificationActions}>
        <button type="button" disabled={busy || !code} onClick={() => void save()}>{t("通知を許可して開始", "Allow and start alerts")}</button>
        <button type="button" disabled={busy || !code} onClick={() => void save(true)}>{t("この端末で停止", "Stop on this device")}</button>
      </div>
      <p className={styles.pilotNote}>{t("開始時にスマホの通知許可を確認します。停止にも試験用コードが必要です。", "Your phone will ask for notification permission when you start. The pilot code is also required to stop alerts.")}</p>
    </>}
    {message && <p role="status">{message}</p>}
    </div>}
  </>;
}
