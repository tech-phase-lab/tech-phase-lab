"use client";
import { useEffect, useState } from "react";
import type { Language } from "@/lib/research/data";

export default function NotificationSettings({ lang }: { lang: Language }) {
  const [config, setConfig] = useState<{ enabled: boolean; publicKey?: string; tickers?: string[] } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/research/notifications", { signal: controller.signal }).then(r => r.json()).then(setConfig).catch(() => {});
    try { const saved = JSON.parse(localStorage.getItem("tech-phase-push-tickers") || "[]");
      if (Array.isArray(saved) && saved.every(x => typeof x === "string")) setSelected(saved.slice(0,50));
    } catch { /* Preferences are optional. */ }
    return () => controller.abort();
  }, []);
  async function save(remove = false) {
    setBusy(true); setMessage("");
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        throw new Error(t("iPhoneではSafariからホーム画面に追加し、そのアイコンから開いてください。", "On iPhone, add this site to your Home Screen in Safari, then open its icon."));
      }
      if (!remove && (!selected.length || !config?.publicKey)) throw new Error(t("銘柄を選んでください。", "Select at least one ticker."));
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
          tickers: selected, language: lang, code }) });
      if (!response.ok) throw new Error(t("保存できませんでした。試験コードと接続を確認してください。", "Could not save. Check the pilot code and connection."));
      if (remove) await subscription.unsubscribe();
      try { localStorage.setItem("tech-phase-push-tickers", JSON.stringify(selected)); } catch { /* Optional */ }
      setCode("");
      setMessage(remove ? t("この端末の通知を停止しました。", "Notifications stopped on this device.") : t("保存しました。選んだ銘柄の新しい目標株価変更を通知します。", "Saved. New price target changes for your selected tickers will be sent."));
    } catch (error) { setMessage(error instanceof Error ? error.message : t("設定できませんでした。", "Setup failed.")); }
    finally { setBusy(false); }
  }
  return <details style={{ margin: "16px 0", padding: 12, border: "1px solid #64748b", borderRadius: 8 }}>
    <summary>{t("スマホ通知の設定", "Phone notifications")}</summary>
    {!config?.enabled ? <p>{t("端末への通知は準備中です。まだ通知は送信されません。", "Device notifications are being prepared. No notifications are sent yet.")}</p> : <>
      <p>{t("試験用：目標株価の変更を受け取る銘柄を選んでください。", "Pilot: select tickers for price target notifications.")}</p>
      <fieldset disabled={busy}><legend>{t("通知する銘柄", "Tickers to notify")}</legend>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>{config.tickers?.map(ticker => <label key={ticker}>
          <input type="checkbox" checked={selected.includes(ticker)} onChange={e => setSelected(old => e.target.checked ? [...old, ticker] : old.filter(x => x !== ticker))} /> {ticker}
        </label>)}</div>
      </fieldset>
      <p><label>{t("試験用コード", "Pilot code")} <input type="password" autoComplete="off" value={code} onChange={e => setCode(e.target.value)} /></label></p>
      <button disabled={busy || !code || !selected.length} onClick={() => void save()}>{t("通知を許可して保存", "Enable and save")}</button>{" "}
      <button disabled={busy || !code} onClick={() => void save(true)}>{t("この端末の通知を停止", "Stop on this device")}</button>
    </>}
    <p role="status">{message}</p>
  </details>;
}
