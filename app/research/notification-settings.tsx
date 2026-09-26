"use client";
import { useEffect, useState } from "react";
import type { Language } from "@/lib/research/data";

export default function NotificationSettings({ lang }: { lang: Language }) {
  const [config, setConfig] = useState<{ enabled: boolean; publicKey?: string; tickers?: string[] } | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
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
        throw new Error(t("iPhoneではSafariからホーム画面に追加し、そのアイコンから開いてください。", "On iPhone, add this site to your Home Screen in Safari, then open its icon."));
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
  return <details style={{ margin: "16px 0", padding: 12, border: "1px solid #64748b", borderRadius: 8 }}>
    <summary>{t("スマホ通知の設定", "Phone notifications")}</summary>
    {!config?.enabled ? <p>{t("端末への通知は準備中です。まだ通知は送信されません。", "Device notifications are being prepared. No notifications are sent yet.")}</p> : <>
      <p>{t("3つの情報源から取得した目標株価の引き上げ・引き下げを、まとめて通知します。銘柄の選択は不要です。", "Receive price target increases and decreases from all three sources. No ticker selection required.")}</p>
      <p><label>{t("試験用コード", "Pilot code")} <input style={{ border: "1px solid #64748b", borderRadius: 6, padding: "8px 10px", display: "block", width: "100%", maxWidth: 380, margin: "8px 0" }} type="password" autoComplete="off" value={code} onChange={e => setCode(e.target.value)} /></label></p>
      <button style={{ padding: "8px 12px", border: "1px solid #64748b", borderRadius: 6, margin: "4px 8px 4px 0" }} disabled={busy || !code} onClick={() => void save()}>{t("通知を許可して保存", "Enable and save")}</button>{" "}
      <button style={{ padding: "8px 12px", border: "1px solid #64748b", borderRadius: 6, margin: "4px 8px 4px 0" }} disabled={busy || !code} onClick={() => void save(true)}>{t("この端末の通知を停止", "Stop on this device")}</button>
    </>}
    <p role="status">{message}</p>
  </details>;
}
